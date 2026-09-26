import { createClerkClient } from '@clerk/backend';

import { AuthenticationDenied } from './application-principal';
import { resolveApplicationPrincipal } from './resolve-principal';

import type { ApplicationPrincipal } from './application-principal';
import type { AuthConfig } from '../config-types';
import type { D1AccountRepository } from './d1-account-repository';
import type { VerifiedSessionIdentity } from './resolve-principal';

export interface BrowserAuthAdapter {
  authenticate(request: Request): Promise<ApplicationPrincipal>;
}

export function createClerkBrowserAdapter(
  config: AuthConfig,
  accounts: Pick<D1AccountRepository, 'findOrCreateAccount'>,
): BrowserAuthAdapter {
  const client = createClerkClient({
    publishableKey: config.publishableKey,
    secretKey: config.secretKey,
    ...(config.jwtKey ? { jwtKey: config.jwtKey } : {}),
    telemetry: { disabled: true },
  });

  async function verify(request: Request): Promise<VerifiedSessionIdentity> {
    const origin = request.headers.get('Origin');
    const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);

    // Cookie authentication must not authorize cross-origin mutations.
    if ((origin !== null && origin !== config.origin) || (!safeMethod && !origin)) {
      throw new AuthenticationDenied();
    }

    const state = await client.authenticateRequest(request, {
      acceptsToken: 'session_token',
      authorizedParties: [config.origin],
      clockSkewInMs: 0,
    });

    if (!state.isAuthenticated) {
      throw new AuthenticationDenied();
    }

    const auth = state.toAuth();

    if (
      !auth.userId ||
      !auth.sessionId ||
      auth.sessionClaims.iss !== config.issuer ||
      auth.sessionClaims.azp !== config.origin
    ) {
      throw new AuthenticationDenied();
    }

    // Recheck revocation and primary email on each protected request.
    const session = await client.sessions.getSession(auth.sessionId);

    if (
      session.id !== auth.sessionId ||
      session.userId !== auth.userId ||
      session.status !== 'active'
    ) {
      throw new AuthenticationDenied();
    }

    const user = await client.users.getUser(auth.userId);
    const primary = user.emailAddresses.find(email => email.id === user.primaryEmailAddressId);

    if (
      user.id !== auth.userId ||
      user.banned !== false ||
      user.locked !== false ||
      !primary?.id ||
      primary.verification?.status !== 'verified'
    ) {
      throw new AuthenticationDenied();
    }

    return {
      issuer: config.issuer,
      subject: auth.userId,
      emailVerified: true,
      canModerate: user.publicMetadata?.role === 'admin',
      session: {
        kind: 'browser',
        expiresAt: Math.min(auth.sessionClaims.exp * 1000, session.expireAt),
      },
    };
  }

  return {
    async authenticate(request): Promise<ApplicationPrincipal> {
      let identity: VerifiedSessionIdentity;

      try {
        identity = await verify(request);
      } catch {
        // Never expose provider payloads, credentials or validation errors.
        throw new AuthenticationDenied();
      }

      // Storage failures remain server errors, not failed credentials.
      return resolveApplicationPrincipal(identity, accounts);
    },
  };
}
