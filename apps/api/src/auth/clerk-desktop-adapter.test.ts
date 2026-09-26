import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationDenied } from './application-principal';
import { createClerkDesktopAdapter } from './clerk-desktop-adapter';

const config = {
  origin: 'https://timmy.example',
  issuer: 'https://browser.clerk.accounts.dev',
  publishableKey: `pk_test_${btoa('browser.clerk.accounts.dev$')}`,
  secretKey: 'sk_test_fixture',
  jwtKey: undefined,
  desktopClientId: 'desktop_fixture',
};
const accessToken = 'opaque-fixture';
const now = 1_800_000_000_000;
const verifiedToken = {
  object: 'clerk_idp_oauth_access_token',
  client_id: config.desktopClientId,
  subject: 'user_desktop',
  scopes: ['email', 'offline_access'],
  revoked: false,
  expired: false,
  expiration: now / 1000 + 120,
};
const verifiedUser = {
  object: 'user',
  id: verifiedToken.subject,
  banned: false,
  locked: false,
  phone_numbers: [],
  web3_wallets: [],
  external_accounts: [],
  primary_email_address_id: 'email_primary',
  email_addresses: [
    {
      id: 'email_primary',
      linked_to: [],
      email_address: 'private@example.com',
      verification: { status: 'verified' },
    },
  ],
  public_metadata: { role: 'admin' },
};
const accounts = { findOrCreateAccount: vi.fn<() => Promise<string>>() };
const transport = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  accounts.findOrCreateAccount.mockReset().mockResolvedValue('account_persistent');
  transport
    .mockReset()
    .mockResolvedValueOnce(Response.json(verifiedToken))
    .mockResolvedValueOnce(Response.json(verifiedUser));
  vi.stubGlobal('fetch', transport);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Clerk desktop authentication', () => {
  it('verifies online, converts REST seconds, and grants no admin privilege or provider data', async () => {
    const principal = await createClerkDesktopAdapter(config, accounts).authenticate(accessToken);
    expect(principal).toEqual({
      accountId: 'account_persistent',
      emailVerified: true,
      canModerate: false,
      session: { kind: 'desktop', expiresAt: now + 120_000 },
    });
    expect(accounts.findOrCreateAccount).toHaveBeenCalledExactlyOnceWith({
      issuer: config.issuer,
      subject: verifiedToken.subject,
    });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]).toEqual([
      'https://api.clerk.com/v1/oauth_applications/access_tokens/verify',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        body: JSON.stringify({ access_token: accessToken }),
      }),
    ]);
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get('Clerk-API-Version')).toBe(
      '2026-05-12',
    );
    expect(transport.mock.calls[1]?.[0]).toBe('https://api.clerk.com/v1/users/user_desktop');
  });

  it.each([
    { client_id: 'another-client' },
    { scopes: ['offline_access'] },
    { subject: '' },
    { revoked: true },
    { revoked: undefined },
    { expired: true },
    { expiration: now / 1000 },
    { expiration: null },
    { expiration: 'tomorrow' },
    { object: 'session' },
  ])('rejects invalid provider token metadata: %j', async override => {
    transport.mockReset().mockResolvedValueOnce(Response.json({ ...verifiedToken, ...override }));
    await expect(
      createClerkDesktopAdapter(config, accounts).authenticate(accessToken),
    ).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findOrCreateAccount).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    { banned: true },
    { locked: true },
    { id: 'other' },
    { primary_email_address_id: null },
    { email_addresses: [{ id: 'email_primary', verification: { status: 'unverified' } }] },
  ])('rejects inactive users and unverified primary email: %j', async override => {
    transport
      .mockReset()
      .mockResolvedValueOnce(Response.json(verifiedToken))
      .mockResolvedValueOnce(Response.json({ ...verifiedUser, ...override }));
    await expect(
      createClerkDesktopAdapter(config, accounts).authenticate(accessToken),
    ).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findOrCreateAccount).not.toHaveBeenCalled();
  });

  it('checks revocation again even when local token expiry is still in the future', async () => {
    const adapter = createClerkDesktopAdapter(config, accounts);
    await adapter.authenticate(accessToken);
    transport.mockResolvedValueOnce(Response.json({ ...verifiedToken, revoked: true }));
    await expect(adapter.authenticate(accessToken)).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findOrCreateAccount).toHaveBeenCalledOnce();
  });

  it.each([302, 401, 404, 429, 500])(
    'fails closed on provider HTTP %i without exposing its body',
    async status => {
      transport
        .mockReset()
        .mockResolvedValueOnce(new Response('private provider body', { status }));
      await expect(
        createClerkDesktopAdapter(config, accounts).authenticate(accessToken),
      ).rejects.toThrow('Authentication required.');
      expect(accounts.findOrCreateAccount).not.toHaveBeenCalled();
    },
  );

  it('sanitizes network failures', async () => {
    transport.mockReset().mockRejectedValueOnce(new Error('private credential details'));
    await expect(
      createClerkDesktopAdapter(config, accounts).authenticate(accessToken),
    ).rejects.toThrow('Authentication required.');
    expect(accounts.findOrCreateAccount).not.toHaveBeenCalled();
  });

  it('rechecks expiry after resolving the account', async () => {
    accounts.findOrCreateAccount.mockImplementationOnce(() => {
      vi.mocked(Date.now).mockReturnValue(now + 120_000);

      return Promise.resolve('account_persistent');
    });
    await expect(
      createClerkDesktopAdapter(config, accounts).authenticate(accessToken),
    ).rejects.toThrow(AuthenticationDenied);
  });

  it('preserves repository failures as server errors', async () => {
    const failure = new Error('Storage unavailable');
    accounts.findOrCreateAccount.mockRejectedValueOnce(failure);
    await expect(
      createClerkDesktopAdapter(config, accounts).authenticate(accessToken),
    ).rejects.toBe(failure);
  });

  it('requires the explicitly configured desktop client', () => {
    expect(() => createClerkDesktopAdapter({ ...config, desktopClientId: '' }, accounts)).toThrow(
      'Desktop authentication is not configured.',
    );
    expect(transport).not.toHaveBeenCalled();
  });
});
