import { z } from 'zod';

import { BenchmarkRequestError } from './repository';

import type { Navigation } from './d1-navigation';

const snapshotSchema = z.strictObject({
  watermark: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  expires: z.number().int().nonnegative(),
});
const navigationSchema = z.strictObject({
  version: z.literal(1),
  kind: z.enum(['cur', 'hg']),
  snapshot: snapshotSchema,
  binding: z.string(),
  hardware: z.tuple([z.string(), z.string(), z.number().int().positive()]).optional(),
  after: z.tuple([z.string(), z.string(), z.string()]).optional(),
});
const encoder = new TextEncoder();

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character =>
    character.charCodeAt(0),
  );
}

export class NavigationToken {
  private key: Promise<CryptoKey> | undefined;
  constructor(private readonly secret: string | undefined) {}

  private signingKey(): Promise<CryptoKey> {
    if (!this.secret) {
      throw new Error('Benchmark cursor signing key is not configured.');
    }

    this.key ??= crypto.subtle.importKey(
      'raw',
      encoder.encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );

    return this.key;
  }

  private async binding(value: string): Promise<string> {
    return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
  }

  async sign(kind: 'cur' | 'hg', navigation: Navigation): Promise<string> {
    const payload = encoder.encode(
      JSON.stringify(
        navigationSchema.parse({
          ...navigation,
          binding: await this.binding(navigation.binding),
          version: 1,
          kind,
        }),
      ),
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign('HMAC', await this.signingKey(), payload),
    );
    const bytes = new Uint8Array(payload.length + signature.length);
    bytes.set(payload);
    bytes.set(signature, payload.length);

    return kind + '_' + encode(bytes);
  }

  async verify(token: string, binding: string, kind: 'cur' | 'hg'): Promise<Navigation> {
    const invalid = kind === 'cur' ? 'invalid_cursor' : 'group_key_stale';
    const key = await this.signingKey();

    // Old database-backed links cannot be resumed after the migration.
    if (token.startsWith(kind + '_') && /^(cur|hg)_[a-f0-9]{32}$/.test(token)) {
      throw new BenchmarkRequestError(kind === 'cur' ? 'cursor_stale' : 'group_key_stale');
    }

    try {
      if (token.length > 4096 || !token.startsWith(kind + '_') || !/^[A-Za-z0-9_-]+$/.test(token)) {
        throw new Error('Invalid token');
      }

      const bytes = decode(token.slice(kind.length + 1));

      if (bytes.length <= 32 || encode(bytes) !== token.slice(kind.length + 1)) {
        throw new Error('Invalid encoding');
      }

      const payload = bytes.slice(0, -32);

      if (!(await crypto.subtle.verify('HMAC', key, bytes.slice(-32), payload))) {
        throw new Error('Invalid signature');
      }

      const parsed = navigationSchema.parse(JSON.parse(new TextDecoder().decode(payload)));

      if (
        parsed.kind !== kind ||
        parsed.binding !== (await this.binding(binding)) ||
        (kind === 'cur' && !parsed.after) ||
        (kind === 'hg' && !parsed.hardware)
      ) {
        throw new Error('Invalid binding');
      }

      return {
        snapshot: parsed.snapshot,
        binding,
        ...(parsed.hardware ? { hardware: parsed.hardware } : {}),
        ...(parsed.after ? { after: parsed.after } : {}),
      };
    } catch {
      throw new BenchmarkRequestError(invalid);
    }
  }
}
