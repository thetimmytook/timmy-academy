import { describe, expect, it, vi } from 'vitest';

import { AuthenticationDenied } from './application-principal';
import { resolveApplicationPrincipal } from './resolve-principal';

import type { VerifiedSessionIdentity } from './resolve-principal';

const now = 1_800_000_000_000;
const proof: VerifiedSessionIdentity = {
  issuer: 'https://auth.example',
  subject: 'provider_user',
  emailVerified: true,
  session: { kind: 'browser', expiresAt: now + 60_000 },
};

describe('application principal resolution', () => {
  it.each(['browser', 'desktop'] as const)(
    'projects only private application fields for %s',
    async kind => {
      const accounts = { findOrCreateAccount: vi.fn().mockResolvedValue('account_1') };
      const identity = {
        ...proof,
        accountId: 'untrusted_account',
        email: 'private@example.com',
        token: 'private_token',
        session: { ...proof.session, kind, providerSessionId: 'private_session' },
      };
      expect(await resolveApplicationPrincipal(identity, accounts, () => now)).toEqual({
        accountId: 'account_1',
        emailVerified: true,
        session: { kind, expiresAt: proof.session.expiresAt },
      });
      expect(accounts.findOrCreateAccount).toHaveBeenCalledExactlyOnceWith({
        issuer: proof.issuer,
        subject: proof.subject,
      });
    },
  );

  it.each([
    null,
    { ...proof, issuer: '' },
    { ...proof, subject: '' },
    { ...proof, subject: 123 },
    { ...proof, emailVerified: false },
    { ...proof, emailVerified: 'true' },
    { ...proof, session: undefined },
    { ...proof, session: { ...proof.session, kind: 'unknown' } },
    ...[now, now - 1, NaN, Infinity, '1900000000000'].map(expiresAt => ({
      ...proof,
      session: { ...proof.session, expiresAt },
    })),
  ])('rejects invalid or expired evidence before account creation: %j', async identity => {
    const accounts = { findOrCreateAccount: vi.fn() };
    await expect(
      resolveApplicationPrincipal(identity as VerifiedSessionIdentity, accounts, () => now),
    ).rejects.toThrow(AuthenticationDenied);
    expect(accounts.findOrCreateAccount).not.toHaveBeenCalled();
  });

  it('rejects a session that expires while resolving the account', async () => {
    let clock = now;
    const accounts = {
      findOrCreateAccount: vi.fn(() => {
        clock = proof.session.expiresAt;

        return Promise.resolve('account_1');
      }),
    };
    await expect(resolveApplicationPrincipal(proof, accounts, () => clock)).rejects.toThrow(
      AuthenticationDenied,
    );
    expect(accounts.findOrCreateAccount).toHaveBeenCalledOnce();
  });

  it('does not issue a principal or disguise a repository outage as failed authentication', async () => {
    const failure = new Error('Database unavailable');
    const accounts = { findOrCreateAccount: vi.fn().mockRejectedValue(failure) };
    await expect(resolveApplicationPrincipal(proof, accounts, () => now)).rejects.toBe(failure);
  });

  it('snapshots verified session context before the asynchronous account lookup', async () => {
    const identity = { ...proof, session: { ...proof.session } };
    const accounts = {
      findOrCreateAccount: vi.fn(() => {
        identity.session.kind = 'desktop';
        identity.session.expiresAt += 60_000;

        return Promise.resolve('account_1');
      }),
    };
    const principal = await resolveApplicationPrincipal(identity, accounts, () => now);
    expect(principal.session).toEqual(proof.session);
    principal.session.expiresAt = 0;
    expect(identity.session.expiresAt).toBe(now + 120_000);
  });
});
