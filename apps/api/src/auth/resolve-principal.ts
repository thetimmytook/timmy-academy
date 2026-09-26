import { z } from 'zod';

import { AuthenticationDenied } from './application-principal';

import type { ApplicationPrincipal } from './application-principal';
import type { D1AccountRepository, VerifiedIdentity } from './d1-account-repository';

/** Only trusted verifier output, after credential, issuer, audience and revocation checks. */
export interface VerifiedSessionIdentity extends VerifiedIdentity {
  emailVerified: boolean;
  canModerate?: boolean;
  session: ApplicationPrincipal['session'];
}

const verifiedSessionSchema = z.object({
  issuer: z.string().min(1),
  subject: z.string().min(1),
  emailVerified: z.literal(true),
  canModerate: z.boolean().default(false),
  session: z.object({
    kind: z.enum(['browser', 'desktop']),

    // Absolute Unix time in milliseconds, matching the application clock.
    expiresAt: z.number(),
  }),
});

/** Resolves private application context; this function does not verify credentials. */
export async function resolveApplicationPrincipal(
  identity: VerifiedSessionIdentity,
  accounts: Pick<D1AccountRepository, 'findOrCreateAccount'>,
  now: () => number = Date.now,
): Promise<ApplicationPrincipal> {
  // Parsing takes a snapshot and discards provider-specific fields before any await.
  const result = verifiedSessionSchema.safeParse(identity);

  if (!result.success || result.data.session.expiresAt <= now()) {
    throw new AuthenticationDenied();
  }

  const { issuer, subject, session, canModerate } = result.data;
  const accountId = await accounts.findOrCreateAccount({ issuer, subject });

  // A valid identity mapping may persist, but an expired session gets no principal.
  if (session.expiresAt <= now()) {
    throw new AuthenticationDenied();
  }

  return { accountId, emailVerified: true, canModerate, session };
}
