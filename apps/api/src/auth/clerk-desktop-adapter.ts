import { createClerkClient } from '@clerk/backend';
import { z } from 'zod';

import { AuthenticationDenied } from './application-principal';
import { resolveApplicationPrincipal } from './resolve-principal';

import type { ApplicationPrincipal } from './application-principal';
import type { AuthConfig } from '../config-types';
import type { D1AccountRepository } from './d1-account-repository';
import type { VerifiedSessionIdentity } from './resolve-principal';

const tokenSchema = z.object({
  object: z.literal('clerk_idp_oauth_access_token'),
  client_id: z.string().min(1),
  subject: z.string().min(1),
  scopes: z.array(z.string()),
  revoked: z.literal(false),
  expired: z.literal(false),
  expiration: z.number().positive(),
});

export function createClerkDesktopAdapter(
  config: AuthConfig,
  accounts: Pick<D1AccountRepository, 'findOrCreateAccount'>,
): { authenticate(accessToken: string): Promise<ApplicationPrincipal> } {
  if (!config.desktopClientId) {
    throw new Error('Desktop authentication is not configured.');
  }

  const client = createClerkClient({
    publishableKey: config.publishableKey,
    secretKey: config.secretKey,
    telemetry: { disabled: true },
  });

  async function verify(accessToken: string): Promise<VerifiedSessionIdentity> {
    // Verify online on every request: a local expiry check cannot detect revocation.
    const response = await fetch(
      'https://api.clerk.com/v1/oauth_applications/access_tokens/verify',
      {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          'Content-Type': 'application/json',
          'Clerk-API-Version': '2026-05-12',
        },
        body: JSON.stringify({ access_token: accessToken }),
      },
    );

    if (!response.ok) {
      throw new AuthenticationDenied();
    }

    const token = tokenSchema.parse(await response.json());

    // This pinned REST response uses Unix seconds (unlike browser Session.expireAt).
    const expiresAt = token.expiration * 1000;

    if (
      token.client_id !== config.desktopClientId ||
      !token.scopes.includes('email') ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      throw new AuthenticationDenied();
    }

    const user = await client.users.getUser(token.subject);
    const primary = user.emailAddresses.find(email => email.id === user.primaryEmailAddressId);

    if (
      user.id !== token.subject ||
      user.banned !== false ||
      user.locked !== false ||
      !primary?.id ||
      primary.verification?.status !== 'verified'
    ) {
      throw new AuthenticationDenied();
    }

    // The server secret and allowed client belong to this configured Clerk issuer.
    // Email and provider metadata never determine the account or desktop privileges.
    return {
      issuer: config.issuer,
      subject: token.subject,
      emailVerified: true,
      canModerate: false,
      session: { kind: 'desktop', expiresAt },
    };
  }

  return {
    async authenticate(accessToken): Promise<ApplicationPrincipal> {
      let identity: VerifiedSessionIdentity;

      try {
        identity = await verify(accessToken);
      } catch {
        throw new AuthenticationDenied();
      }

      // Preserve database failures as server errors; never expose provider errors.
      return resolveApplicationPrincipal(identity, accounts);
    },
  };
}
