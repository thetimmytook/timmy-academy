import type { ApplicationPrincipal } from '../auth/application-principal';

export { AuthenticationDenied } from '../auth/application-principal';
export type { ApplicationPrincipal } from '../auth/application-principal';

export interface AuthAdapter {
  authenticate(authorization: string | undefined): Promise<ApplicationPrincipal>;
}

/** Private, pre-provisioned mappings for this PoC; no implicit email linking. */
export interface AccountDirectory {
  findAccount(issuer: string, subject: string): Promise<string | null>;
}
