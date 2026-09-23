import { generateKeyPairSync, createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationDenied } from './application-principal';
import { createClerkBrowserAdapter } from './clerk-browser-adapter';
import { D1AccountRepository } from './d1-account-repository';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = {
  origin: 'https://timmy.example',
  issuer: 'https://browser.clerk.accounts.dev',
  publishableKey: `pk_test_${btoa('browser.clerk.accounts.dev$')}`,
  secretKey: 'sk_test_fixture',
  jwtKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
};
const accounts = { findOrCreateAccount: vi.fn<() => Promise<string>>() };
const transport = vi.fn<typeof fetch>();
const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: config.issuer,
  sub: 'user_browser',
  sid: 'sess_browser',
  azp: config.origin,
  iat: now - 1,
  nbf: now - 1,
  exp: now + 120,
};
const activeSession = {
  object: 'session',
  id: claims.sid,
  user_id: claims.sub,
  status: 'active',
  expire_at: (now + 3600) * 1000,
};
const verifiedUser = {
  object: 'user',
  phone_numbers: [],
  web3_wallets: [],
  external_accounts: [],
  id: claims.sub,
  banned: false,
  locked: false,
  primary_email_address_id: 'email_primary',
  email_addresses: [
    {
      id: 'email_primary',
      linked_to: [],
      email_address: 'private@example.com',
      verification: { status: 'verified' },
    },
  ],
};

function base64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function token(overrides: Record<string, unknown> = {}, signingKey = keys.privateKey): string {
  const header = base64url({ alg: 'RS256', typ: 'JWT', kid: 'fixture' });
  const payload = base64url({ ...claims, ...overrides });
  const data = `${header}.${payload}`;

  return `${data}.${createSign('RSA-SHA256').update(data).sign(signingKey, 'base64url')}`;
}

function request(jwt = token(), init: RequestInit = {}): Request {
  return new Request(`${config.origin}/api/private`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, ...init.headers },
  });
}

beforeEach(() => {
  accounts.findOrCreateAccount.mockReset().mockResolvedValue('account_persistent');
  transport
    .mockReset()
    .mockResolvedValueOnce(Response.json(activeSession))
    .mockResolvedValueOnce(Response.json(verifiedUser));
  vi.stubGlobal('fetch', transport);
});
afterEach(() => vi.unstubAllGlobals());

describe('Clerk browser session adapter with real JWT signatures', () => {
  it('persists the same account across verified browser sign-ins through real D1', async () => {
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch() { return new Response("test"); } }',
        compatibilityDate: '2026-09-19',
        d1Databases: ['BENCHMARK_DB'],
      }),
    );

    try {
      const db = await mf.getD1Database('BENCHMARK_DB');

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const migration = await readFile(
        new URL('../../../../infrastructure/migrations/0002_auth-accounts.sql', import.meta.url),
        'utf8',
      );
      await db.batch(
        migration.split('--> statement-breakpoint').map(statement => db.prepare(statement)),
      );
      transport
        .mockResolvedValueOnce(Response.json(activeSession))
        .mockResolvedValueOnce(Response.json(verifiedUser));
      const first = await createClerkBrowserAdapter(
        config,
        new D1AccountRepository(db),
      ).authenticate(request());
      const second = await createClerkBrowserAdapter(
        config,
        new D1AccountRepository(db),
      ).authenticate(request());
      expect(second).toEqual(first);
      expect(
        await db
          .prepare('SELECT account_id FROM account_identities WHERE issuer = ? AND subject = ?')
          .bind(claims.iss, claims.sub)
          .first('account_id'),
      ).toBe(first.accountId);
      expect(await db.prepare('SELECT count(*) FROM accounts').first('count(*)')).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it.each(['bearer', 'cookie'])(
    'verifies %s credentials and returns only an application principal',
    async source => {
      const incoming =
        source === 'cookie'
          ? new Request(`${config.origin}/api/private`, {
              headers: {
                Cookie: `__session=${token()}; __client_uat=${now - 2}; __clerk_db_jwt=fixture`,
              },
            })
          : request();
      const principal = await createClerkBrowserAdapter(config, accounts).authenticate(incoming);
      expect(principal).toEqual({
        accountId: 'account_persistent',
        emailVerified: true,
        session: { kind: 'browser', expiresAt: claims.exp * 1000 },
      });
      expect(accounts.findOrCreateAccount).toHaveBeenCalledExactlyOnceWith({
        issuer: claims.iss,
        subject: claims.sub,
      });
      expect(transport).toHaveBeenCalledTimes(2);
      expect(transport.mock.calls[0]?.[0]).toEqual(
        `https://api.clerk.com/v1/sessions/${claims.sid}`,
      );
      expect(transport.mock.calls[1]?.[0]).toEqual(`https://api.clerk.com/v1/users/${claims.sub}`);
    },
  );

  it.each([
    { iss: 'https://other.clerk.accounts.dev' },
    { azp: 'https://attacker.example' },
    { azp: undefined },
    { exp: now - 1 },
    { nbf: now + 600 },
    { sid: '' },
  ])('rejects invalid signed claims before account or user access: %j', async override => {
    await expect(
      createClerkBrowserAdapter(config, accounts).authenticate(request(token(override))),
    ).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findOrCreateAccount).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects a forged signature', async () => {
    const forged = token({}, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey);
    await expect(
      createClerkBrowserAdapter(config, accounts).authenticate(request(forged)),
    ).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findOrCreateAccount).not.toHaveBeenCalled();
  });

  it.each(['', 'opaque-desktop-token', 'not.a.jwt'])(
    'rejects absent or non-session credentials: %s',
    async value => {
      await expect(
        createClerkBrowserAdapter(config, accounts).authenticate(request(value)),
      ).rejects.toThrow(AuthenticationDenied);
      expect(accounts.findOrCreateAccount).not.toHaveBeenCalled();
    },
  );

  it.each([
    { method: 'POST' },
    { method: 'POST', headers: { Origin: 'https://attacker.example' } },
    { headers: { Origin: 'null' } },
  ])('rejects unsafe request origins before provider access: %j', async init => {
    await expect(
      createClerkBrowserAdapter(config, accounts).authenticate(request(token(), init)),
    ).rejects.toThrow(AuthenticationDenied);
    expect(transport).not.toHaveBeenCalled();
  });

  it('accepts mutations from the configured browser origin', async () => {
    await expect(
      createClerkBrowserAdapter(config, accounts).authenticate(
        request(token(), {
          method: 'POST',
          headers: { Origin: config.origin },
        }),
      ),
    ).resolves.toHaveProperty('accountId', 'account_persistent');
  });

  it.each([{ status: 'revoked' }, { status: 'ended' }, { user_id: 'other' }, { expire_at: 0 }])(
    'rejects inactive or mismatched sessions: %j',
    async override => {
      transport
        .mockReset()
        .mockResolvedValueOnce(Response.json({ ...activeSession, ...override }))
        .mockResolvedValueOnce(Response.json(verifiedUser));
      await expect(
        createClerkBrowserAdapter(config, accounts).authenticate(request()),
      ).rejects.toThrow(AuthenticationDenied);
      expect(accounts.findOrCreateAccount).not.toHaveBeenCalled();
    },
  );

  it.each([
    { banned: true },
    { locked: true },
    { id: 'other' },
    { primary_email_address_id: null },
    { email_addresses: [{ id: 'email_primary', verification: { status: 'unverified' } }] },
  ])('rejects blocked users and unverified primary email: %j', async override => {
    transport
      .mockReset()
      .mockResolvedValueOnce(Response.json(activeSession))
      .mockResolvedValueOnce(Response.json({ ...verifiedUser, ...override }));
    await expect(
      createClerkBrowserAdapter(config, accounts).authenticate(request()),
    ).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findOrCreateAccount).not.toHaveBeenCalled();
  });

  it('rechecks revocation on the next request', async () => {
    const adapter = createClerkBrowserAdapter(config, accounts);
    await adapter.authenticate(request());
    transport.mockResolvedValueOnce(Response.json({ ...activeSession, status: 'revoked' }));
    await expect(adapter.authenticate(request())).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findOrCreateAccount).toHaveBeenCalledOnce();
  });

  it('preserves repository failures as server errors', async () => {
    const failure = new Error('Storage unavailable');
    accounts.findOrCreateAccount.mockRejectedValueOnce(failure);
    await expect(createClerkBrowserAdapter(config, accounts).authenticate(request())).rejects.toBe(
      failure,
    );
  });
});
