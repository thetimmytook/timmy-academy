const encoder = new TextEncoder();

export function encodeTokenBytes(bytes: Uint8Array): string {
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

export class SignedToken {
  private key: Promise<CryptoKey> | undefined;
  constructor(private readonly secret: string | undefined) {}

  assertConfigured(): void {
    if (!this.secret) {
      throw new Error('Benchmark cursor signing key is not configured.');
    }
  }

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

  async sign(prefix: string, value: unknown): Promise<string> {
    const payload = encoder.encode(JSON.stringify(value));
    const signature = new Uint8Array(
      await crypto.subtle.sign('HMAC', await this.signingKey(), payload),
    );
    const bytes = new Uint8Array(payload.length + signature.length);
    bytes.set(payload);
    bytes.set(signature, payload.length);

    return prefix + '_' + encodeTokenBytes(bytes);
  }

  async verify(prefix: string, token: string): Promise<unknown> {
    const key = await this.signingKey();

    if (token.length > 4096 || !token.startsWith(prefix + '_') || !/^[A-Za-z0-9_-]+$/.test(token)) {
      throw new Error('Invalid token');
    }

    const bytes = decode(token.slice(prefix.length + 1));

    if (bytes.length <= 32 || encodeTokenBytes(bytes) !== token.slice(prefix.length + 1)) {
      throw new Error('Invalid encoding');
    }

    const payload = bytes.slice(0, -32);

    if (!(await crypto.subtle.verify('HMAC', key, bytes.slice(-32), payload))) {
      throw new Error('Invalid signature');
    }

    return JSON.parse(new TextDecoder().decode(payload)) as unknown;
  }
}
