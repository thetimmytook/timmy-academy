import { AuthenticationDenied } from './auth-adapter';

import type { AccountDirectory } from './auth-adapter';

interface Identity {
  issuer: string;
  subject: string;
}

/** Trusted verifier output, never client claims. Email is deliberately not a key. */
export interface RehearsalIdentityProof extends Identity {
  sessionId: string;
  expiresAt: number;
  emailVerified: true;
}

type VerifyIdentity = (credential: string) => Promise<RehearsalIdentityProof>;

interface PendingLink {
  source: RehearsalIdentityProof;
  accountId: string;
  expiresAt: number;
}

function identityKey(identity: Identity): string {
  return JSON.stringify([identity.issuer, identity.subject]);
}

/**
 * Test-only, single-process migration model. No HTTP routes or live provider wiring.
 * Verifiers stand in for independent provider authentication, including revocation.
 * Production needs persistent unique identity keys and an atomic link transaction.
 */
export class MigrationRehearsal implements AccountDirectory {
  private readonly accounts = new Map<string, string>();
  private readonly pending = new Map<string, PendingLink>();

  constructor(
    mappings: readonly (Identity & { accountId: string })[],
    private readonly targetIssuer: string,
    private readonly verifySource: VerifyIdentity,
    private readonly verifyTarget: VerifyIdentity,
    private readonly now: () => number = Date.now,
  ) {
    for (const mapping of mappings) {
      const key = identityKey(mapping);

      if (this.accounts.has(key)) {
        throw new AuthenticationDenied();
      }

      this.accounts.set(key, mapping.accountId);
    }
  }

  findAccount(issuer: string, subject: string): Promise<string | null> {
    return Promise.resolve(this.accounts.get(identityKey({ issuer, subject })) ?? null);
  }

  async begin(sourceCredential: string): Promise<string> {
    const source = await this.verify(this.verifySource, sourceCredential);
    const accountId = this.accounts.get(identityKey(source));

    if (!accountId || source.issuer === this.targetIssuer) {
      throw new AuthenticationDenied();
    }

    const ticket = crypto.randomUUID();
    this.pending.set(ticket, {
      source: { ...source },
      accountId,
      expiresAt: Math.min(this.now() + 300_000, source.expiresAt),
    });

    return ticket;
  }

  async complete(
    ticket: string,
    sourceCredential: string,
    targetCredential: string,
  ): Promise<void> {
    // Reauthenticate both sides at completion; the ticket alone grants no authority.
    const source = await this.verify(this.verifySource, sourceCredential);
    const target = await this.verify(this.verifyTarget, targetCredential);
    const pending = this.pending.get(ticket);
    const now = this.now();

    if (
      !pending ||
      pending.expiresAt <= now ||
      source.expiresAt <= now ||
      target.expiresAt <= now ||
      identityKey(source) !== identityKey(pending.source) ||
      source.sessionId !== pending.source.sessionId ||
      this.accounts.get(identityKey(source)) !== pending.accountId ||
      target.issuer !== this.targetIssuer
    ) {
      throw new AuthenticationDenied();
    }

    const targetKey = identityKey(target);

    if (this.accounts.has(targetKey)) {
      throw new AuthenticationDenied();
    }

    // No await between consumption and insertion: atomic only in this in-memory model.
    this.pending.delete(ticket);
    this.accounts.set(targetKey, pending.accountId);
  }

  private async verify(
    verifier: VerifyIdentity,
    credential: string,
  ): Promise<RehearsalIdentityProof> {
    try {
      const proof = await verifier(credential);

      if (
        !proof.issuer ||
        !proof.subject ||
        !proof.sessionId ||
        proof.emailVerified !== true ||
        !Number.isFinite(proof.expiresAt) ||
        proof.expiresAt <= this.now()
      ) {
        throw new AuthenticationDenied();
      }

      return { ...proof };
    } catch {
      throw new AuthenticationDenied();
    }
  }
}
