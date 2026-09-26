import { z } from 'zod';

import { BenchmarkRequestError } from './repository';
import { SignedToken, encodeTokenBytes } from './signed-token';

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
export class BenchmarkCursor {
  private readonly codec: SignedToken;
  constructor(secret: string | undefined) {
    this.codec = new SignedToken(secret);
  }

  private async binding(value: string): Promise<string> {
    return encodeTokenBytes(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    );
  }

  async sign(kind: 'cur' | 'hg', navigation: Navigation): Promise<string> {
    return this.codec.sign(
      kind,
      navigationSchema.parse({
        ...navigation,
        binding: await this.binding(navigation.binding),
        version: 1,
        kind,
      }),
    );
  }

  async verify(token: string, binding: string, kind: 'cur' | 'hg'): Promise<Navigation> {
    this.codec.assertConfigured();

    if (token.startsWith(kind + '_') && /^(cur|hg)_[a-f0-9]{32}$/.test(token)) {
      throw new BenchmarkRequestError(kind === 'cur' ? 'cursor_stale' : 'group_key_stale');
    }

    try {
      const parsed = navigationSchema.parse(await this.codec.verify(kind, token));

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
      throw new BenchmarkRequestError(kind === 'cur' ? 'invalid_cursor' : 'group_key_stale');
    }
  }
}
