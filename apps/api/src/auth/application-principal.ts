/** Private auth context. Never serialize it into public benchmark responses. */
export interface ApplicationPrincipal {
  accountId: string;
  emailVerified: true;
  session: { kind: 'browser' | 'desktop'; expiresAt: number };
}

export class AuthenticationDenied extends Error {
  constructor() {
    super('Authentication required.');
  }
}
