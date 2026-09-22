import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryBenchmarkRepository } from '../benchmark/in-memory-repository';
import { createApp } from '../index';

import { AuthenticationDenied } from './auth-adapter';
import { registerAuthPocApi } from './auth-poc.api';
import { createClerkTestAdapter } from './clerk-adapter';

import type { AuthAdapter } from './auth-adapter';
import type { Mock } from 'vitest';

const config = {
  issuer: 'https://auth-poc.clerk.accounts.dev',
  clientId: 'test-desktop-client',
  secretKey: 'sk_test_fixture_only',
};
const now = 1_800_000_000_000;
const authorization = 'Bearer fixture-opaque-credential';
const checkPath = '/api/auth/v1/poc/check';
const accountId = 'acc_fixture';
const deniedMessage = 'Authentication required.';
const validToken = {
  object: 'clerk_idp_oauth_access_token',
  subject: 'user_fixture',
  client_id: config.clientId,
  scopes: ['email', 'offline_access'],
  revoked: false,
  expired: false,
  expiration: now / 1000 + 60,
};
const validUser = {
  id: validToken.subject,
  banned: false,
  locked: false,
  primary_email_address_id: 'email_primary',
  email_addresses: [
    {
      id: 'email_primary',
      email_address: 'private@example.invalid',
      verification: { status: 'verified' },
    },
  ],
};

function fixture(
  token: unknown = validToken,
  user: unknown = validUser,
): {
  adapter: AuthAdapter;
  accounts: { findAccount: Mock<() => Promise<string | null>> };
  transport: Mock<typeof fetch>;
  app: Hono;
} {
  const transport = vi.fn<typeof fetch>();
  transport.mockResolvedValueOnce(Response.json(token));
  transport.mockResolvedValueOnce(Response.json(user));
  const accounts = { findAccount: vi.fn(() => Promise.resolve<string | null>(accountId)) };
  const adapter = createClerkTestAdapter(config, accounts, transport, () => now);
  const app = new Hono();
  registerAuthPocApi(app, adapter);

  return { adapter, accounts, transport, app };
}

describe('isolated Clerk adapter (mock provider, not live authentication)', () => {
  it('projects only a private application principal and uses the pinned server API', async () => {
    const { adapter, transport, accounts } = fixture();
    expect(await adapter.authenticate(authorization)).toEqual({
      accountId,
      emailVerified: true,
      session: { kind: 'desktop', expiresAt: now + 60_000 },
    });
    expect(accounts.findAccount).toHaveBeenCalledWith(config.issuer, validToken.subject);
    expect(transport).toHaveBeenNthCalledWith(
      1,
      'https://api.clerk.com/v1/oauth_applications/access_tokens/verify',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        body: JSON.stringify({ access_token: 'fixture-opaque-credential' }),
      }),
    );
    expect(transport.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/json',
      'Clerk-API-Version': '2026-05-12',
    });
  });

  it.each([undefined, '', 'Basic abc', 'Bearer a.b.c', 'Bearer a b', `Bearer ${'x'.repeat(4097)}`])(
    'rejects missing, malformed and JWT credentials before sending a request',
    async header => {
      const { adapter, transport } = fixture();
      await expect(adapter.authenticate(header)).rejects.toThrow(AuthenticationDenied);
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each([
    { revoked: true },
    { revoked: undefined },
    { expired: true },
    { expiration: now / 1000 },
    { expiration: null },
    { client_id: 'another-client' },
    { scopes: ['profile'] },
    { object: 'session' },
    { subject: '' },
  ])('rejects invalid token evidence: %j', async override => {
    const { adapter, accounts } = fixture({ ...validToken, ...override });
    await expect(adapter.authenticate(authorization)).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findAccount).not.toHaveBeenCalled();
  });

  it.each([null, { active: false }, {}, 'private provider error'])(
    'fails closed on %j',
    async token => {
      await expect(fixture(token).adapter.authenticate(authorization)).rejects.toThrow(
        AuthenticationDenied,
      );
    },
  );

  it.each([
    { id: 'another-user' },
    { banned: true },
    { locked: true },
    { primary_email_address_id: null },
    { email_addresses: [] },
    { email_addresses: [{ id: 'email_primary', verification: { status: 'unverified' } }] },
    { email_addresses: [{ id: 'other-email', verification: { status: 'verified' } }] },
  ])('requires this user and verified primary email: %j', async override => {
    const { adapter, accounts } = fixture(validToken, { ...validUser, ...override });
    await expect(adapter.authenticate(authorization)).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findAccount).not.toHaveBeenCalled();
  });

  it('refuses an unmapped identity even when email is verified', async () => {
    const { adapter, accounts } = fixture();
    accounts.findAccount.mockResolvedValue(null);
    await expect(adapter.authenticate(authorization)).rejects.toThrow(AuthenticationDenied);
  });

  it('does not derive account identity from the email address', async () => {
    const changedEmail = {
      ...validUser,
      email_addresses: [
        { ...validUser.email_addresses[0], email_address: 'changed@example.invalid' },
      ],
    };
    const first = await fixture().adapter.authenticate(authorization);
    const second = await fixture(validToken, changedEmail).adapter.authenticate(authorization);
    expect(second.accountId).toBe(first.accountId);
  });

  it('rechecks revocation on every request instead of caching success', async () => {
    const { adapter, transport } = fixture();
    await adapter.authenticate(authorization);
    transport.mockResolvedValueOnce(Response.json({ ...validToken, revoked: true }));
    await expect(adapter.authenticate(authorization)).rejects.toThrow(AuthenticationDenied);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it.each([
    { subject: null },
    { subject: undefined },
    { subject: 123 },
    { subject: {} },
    { subject: [] },
    { client_id: null },
    { scopes: 'email' },
    { scopes: ['email', 123] },
    { expiration: String(now / 1000 + 60) },
    { expiration: undefined },
    { revoked: 'false' },
    { expired: undefined },
  ])('rejects damaged token fields before constructing a user request: %j', async override => {
    const { adapter, transport, accounts } = fixture({ ...validToken, ...override });
    await expect(adapter.authenticate(authorization)).rejects.toThrow(AuthenticationDenied);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(accounts.findAccount).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    'private provider payload',
    { ...validUser, id: null },
    { ...validUser, banned: 'false' },
    { ...validUser, locked: undefined },
    { ...validUser, email_addresses: {} },
    { ...validUser, email_addresses: [null] },
    { ...validUser, email_addresses: [{ id: 'email_primary', verification: null }] },
    { ...validUser, email_addresses: [{ id: 'email_primary' }] },
    { ...validUser, email_addresses: [{ id: 'email_primary', verification: { status: true } }] },
  ])('denies damaged user responses without exposing validation details: %j', async user => {
    const { adapter, accounts } = fixture(validToken, user);
    const failure: unknown = await adapter
      .authenticate(authorization)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AuthenticationDenied);
    expect(failure).toHaveProperty('message', deniedMessage);
    expect(failure).not.toHaveProperty('cause');
    expect(failure).not.toHaveProperty('issues');
    expect(accounts.findAccount).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ''])(
    'does not accept matching invalid primary and email IDs: %j',
    async id => {
      // Response.json omits undefined fields: both IDs really are absent on the wire.
      const user = {
        ...validUser,
        primary_email_address_id: id,
        email_addresses: [{ id, verification: { status: 'verified' } }],
      };
      const { app, accounts } = fixture(validToken, user);
      const response = await app.request(checkPath, { headers: { Authorization: authorization } });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ status: 'denied' });
      expect(accounts.findAccount).not.toHaveBeenCalled();
    },
  );

  it('does not substitute a verified secondary email for an unverified primary email', async () => {
    const { adapter } = fixture(validToken, {
      ...validUser,
      email_addresses: [
        { id: 'email_secondary', verification: { status: 'verified' } },
        { id: 'email_primary', verification: { status: 'unverified' } },
      ],
    });
    await expect(adapter.authenticate(authorization)).rejects.toThrow(AuthenticationDenied);
  });

  it('validates only consumed fields and finds the verified primary email among other addresses', async () => {
    const { adapter } = fixture(
      { ...validToken, unused_provider_field: { private: 'ignored' } },
      {
        ...validUser,
        email_addresses: [
          { id: 'email_secondary', verification: null },
          { id: 'email_primary', verification: { status: 'verified' }, email_address: 123 },
        ],
        unused_provider_field: ['ignored'],
      },
    );
    expect(await adapter.authenticate(authorization)).toEqual({
      accountId,
      emailVerified: true,
      session: { kind: 'desktop', expiresAt: now + 60_000 },
    });
  });

  it.each(['token', 'user'])('sanitizes invalid JSON from the %s endpoint', async endpoint => {
    const { adapter, transport, accounts } = fixture();
    transport.mockReset();

    if (endpoint === 'user') {
      transport.mockResolvedValueOnce(Response.json(validToken));
    }

    transport.mockResolvedValueOnce(new Response('{private provider payload'));
    await expect(adapter.authenticate(authorization)).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findAccount).not.toHaveBeenCalled();
  });

  it.each([Number.MAX_VALUE, -Number.MAX_VALUE])(
    'rejects finite expiration that overflows when converted to milliseconds: %s',
    async expiration => {
      expect(Number.isFinite(expiration)).toBe(true);
      expect(Number.isFinite(expiration * 1000)).toBe(false);
      const { adapter, transport, accounts } = fixture({ ...validToken, expiration });
      await expect(adapter.authenticate(authorization)).rejects.toThrow(AuthenticationDenied);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(accounts.findAccount).not.toHaveBeenCalled();
    },
  );

  it.each(['1e400', '-1e400'])(
    'rejects non-finite expiration parsed from JSON: %s',
    async number => {
      const { adapter, transport } = fixture();
      const body = JSON.stringify(validToken).replace(String(validToken.expiration), number);
      transport.mockReset().mockResolvedValueOnce(new Response(body));
      await expect(adapter.authenticate(authorization)).rejects.toThrow(AuthenticationDenied);
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it.each([301, 302, 307, 308, 401, 404, 429, 500])('sanitizes upstream HTTP %i', async status => {
    const { adapter, transport } = fixture();
    transport.mockReset().mockResolvedValue(new Response('secret provider details', { status }));
    await expect(adapter.authenticate(authorization)).rejects.toThrow(deniedMessage);
  });

  it('sanitizes network failures without attaching the original error', async () => {
    const { adapter, transport } = fixture();
    transport.mockReset().mockRejectedValue(new Error('private network data'));
    const failure: unknown = await adapter
      .authenticate(authorization)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AuthenticationDenied);
    expect(failure).toHaveProperty('message', deniedMessage);
    expect(failure).not.toHaveProperty('cause');
  });

  it.each([
    { secretKey: 'sk_live_fixture' },
    { issuer: 'https://clerk.example.com' },
    { issuer: `${config.issuer}/unexpected` },

    // Deliberately insecure input: the adapter must reject it.
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    { issuer: 'http://auth-poc.clerk.accounts.dev' },
    { clientId: '' },
  ])('rejects non-test configuration: %j', override => {
    expect(() => createClerkTestAdapter({ ...config, ...override }, fixture().accounts)).toThrow();
  });
});

describe('PoC route isolation and response privacy', () => {
  it('returns only an allowlisted status with cache disabled', async () => {
    const response = await fixture().app.request(checkPath, {
      headers: { Authorization: authorization },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'verified' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('denies credential URLs before invoking auth', async () => {
    const { app, transport } = fixture();
    const response = await app.request(`${checkPath}?access_token=private`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: 'denied' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('sanitizes an unexpected adapter failure', async () => {
    const app = new Hono();
    registerAuthPocApi(app, {
      authenticate: () => Promise.reject(new Error('private@example.invalid')),
    });
    const response = await app.request(checkPath);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'denied' });
  });

  it('leaves real public search anonymous and PoC routes absent from the product app', async () => {
    const app = createApp(new InMemoryBenchmarkRepository());
    expect((await app.request('/api/bench/v1/runs')).status).toBe(200);
    expect((await app.request(checkPath)).status).toBe(404);
  });
});
