/** Private auth boundary. Never serialize a principal into benchmark responses. */
export interface ApplicationPrincipal {
  accountId: string;
  emailVerified: true;
  session: { kind: 'desktop'; expiresAt: number };
}

export interface AuthAdapter {
  authenticate(authorization: string | undefined): Promise<ApplicationPrincipal>;
}

/** Private, pre-provisioned mappings for this PoC; no implicit email linking. */
export interface AccountDirectory {
  findAccount(issuer: string, subject: string): Promise<string | null>;
}

export class AuthenticationDenied extends Error {
  constructor() {
    super('Authentication required.');
  }
}
