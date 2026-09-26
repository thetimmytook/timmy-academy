import { z } from 'zod';

import { AUTH_POC_REQUEST_TIMEOUT_MS } from '../config';

import { AuthenticationDenied } from './auth-adapter';

import type { AccountDirectory, ApplicationPrincipal, AuthAdapter } from './auth-adapter';

interface ClerkTestConfiguration {
  issuer: string;
  clientId: string;
  secretKey: string;
}

const identifierSchema = z.string().min(1);
const tokenResponseSchema = z.object({
  object: z.literal('clerk_idp_oauth_access_token'),
  subject: identifierSchema,
  client_id: identifierSchema,
  scopes: z.array(z.string()),
  revoked: z.literal(false),
  expired: z.literal(false),
  expiration: z.number(),
});
const userResponseSchema = z.object({
  id: identifierSchema,
  banned: z.literal(false),
  locked: z.literal(false),
  primary_email_address_id: identifierSchema,
  email_addresses: z.array(
    z.object({
      id: identifierSchema,
      verification: z.object({ status: z.string() }).nullish(),
    }),
  ),
});

/** REST is contained here; product code has no Clerk types or SDK dependency. */
export function createClerkTestAdapter(
  config: ClerkTestConfiguration,
  accounts: AccountDirectory,
  transport: typeof fetch = fetch,
  now: () => number = Date.now,
): AuthAdapter {
  const issuer = new URL(config.issuer);

  // Keep this PoC on a Clerk development instance: require an HTTPS origin with
  // no credentials, path, query or fragment, a test secret key and an OAuth client ID.
  // This checks configuration shape, not whether the key and client belong to the issuer.
  if (
    issuer.protocol !== 'https:' ||
    !issuer.hostname.endsWith('.clerk.accounts.dev') ||
    issuer.origin !== config.issuer ||
    !config.secretKey.startsWith('sk_test_') ||
    !config.clientId
  ) {
    throw new Error('A Clerk development instance and test key are required.');
  }

  async function backend(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await transport(`https://api.clerk.com/v1/${path}`, {
      ...init,

      // Workers supports manual/follow only. The non-2xx check below rejects redirects.
      redirect: 'manual',
      signal: AbortSignal.timeout(AUTH_POC_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        'Content-Type': 'application/json',
        'Clerk-API-Version': '2026-05-12',
      },
    });

    if (!response.ok) {
      throw new AuthenticationDenied();
    }

    const body: unknown = await response.json();

    return body;
  }

  async function authenticate(authorization: string | undefined): Promise<ApplicationPrincipal> {
    const match = /^Bearer ([^\s.]+)$/i.exec(authorization ?? '');

    // This experiment deliberately accepts opaque tokens only, never browser/ID JWTs.
    if (!match?.[1] || match[1].length > 4096) {
      throw new AuthenticationDenied();
    }

    const token = tokenResponseSchema.parse(
      await backend('oauth_applications/access_tokens/verify', {
        method: 'POST',
        body: JSON.stringify({ access_token: match[1] }),
      }),
    );
    const expiresAt = token.expiration * 1000;

    if (
      token.client_id !== config.clientId ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now() ||
      !token.scopes.includes('email')
    ) {
      throw new AuthenticationDenied();
    }

    const subject = token.subject;
    const user = userResponseSchema.parse(await backend(`users/${encodeURIComponent(subject)}`));

    if (user.id !== subject) {
      throw new AuthenticationDenied();
    }

    const primary = user.email_addresses.find(email => email.id === user.primary_email_address_id);

    if (primary?.verification?.status !== 'verified') {
      throw new AuthenticationDenied();
    }

    const accountId = await accounts.findAccount(config.issuer, subject);

    if (!accountId) {
      throw new AuthenticationDenied();
    }

    return {
      accountId,
      emailVerified: true,
      canModerate: false,
      session: { kind: 'desktop', expiresAt },
    };
  }

  return {
    async authenticate(authorization): Promise<ApplicationPrincipal> {
      try {
        return await authenticate(authorization);
      } catch {
        // Do not propagate provider payloads, network errors, IDs or credentials.
        throw new AuthenticationDenied();
      }
    },
  };
}
