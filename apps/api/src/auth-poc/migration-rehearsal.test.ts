import { describe, expect, it, vi } from 'vitest';

import { AuthenticationDenied } from './auth-adapter';
import { MigrationRehearsal } from './migration-rehearsal';

import type { RehearsalIdentityProof } from './migration-rehearsal';

const sourceIssuer = 'https://old-provider.example.invalid';
const targetIssuer = 'https://new-provider.example.invalid';
const accountId = 'acc_migration_fixture';
const linkedSubject = 'already-linked';
const initialTime = 1_800_000_000_000;
const sourceCredential = 'synthetic-source-credential';
const targetCredential = 'synthetic-target-credential';
const source: RehearsalIdentityProof = {
  issuer: sourceIssuer,
  subject: 'old-subject',
  sessionId: 'source-session',
  expiresAt: initialTime + 600_000,
  emailVerified: true,
};
const target: RehearsalIdentityProof = {
  ...source,
  issuer: targetIssuer,
  subject: 'new-subject',
  sessionId: 'target-session',
};

function fixture(): {
  model: MigrationRehearsal;
  sourceProofs: Map<string, RehearsalIdentityProof>;
  targetProofs: Map<string, RehearsalIdentityProof>;
  advance: (milliseconds: number) => void;
} {
  let time = initialTime;
  const sourceProofs = new Map([[sourceCredential, { ...source }]]);
  const targetProofs = new Map([[targetCredential, { ...target }]]);

  function verifier(
    proofs: Map<string, RehearsalIdentityProof>,
  ): (credential: string) => Promise<RehearsalIdentityProof> {
    return (credential: string): Promise<RehearsalIdentityProof> => {
      const proof = proofs.get(credential);

      if (!proof) {
        throw new Error('Synthetic provider error containing private data');
      }

      return Promise.resolve(proof);
    };
  }

  const model = new MigrationRehearsal(
    [
      { ...source, accountId },
      { ...target, subject: linkedSubject, accountId: 'acc_other' },
      { ...source, subject: 'other-source', accountId: 'acc_other' },
    ],
    targetIssuer,
    verifier(sourceProofs),
    verifier(targetProofs),
    () => time,
  );

  return {
    model,
    sourceProofs,
    targetProofs,
    advance(milliseconds): void {
      time += milliseconds;
    },
  };
}

describe('local migration rehearsal (synthetic identity proofs, no second provider)', () => {
  it('preserves the account ID and ownership references across two verified identities', async () => {
    const { model } = fixture();
    const privateOwnership = { runOwner: accountId, progressOwner: accountId };
    const before = { ...privateOwnership };
    const ticket = await model.begin(sourceCredential);
    await model.complete(ticket, sourceCredential, targetCredential);
    expect(await model.findAccount(sourceIssuer, source.subject)).toBe(accountId);
    expect(await model.findAccount(targetIssuer, target.subject)).toBe(privateOwnership.runOwner);
    expect(await model.findAccount(targetIssuer, target.subject)).toBe(
      privateOwnership.progressOwner,
    );
    expect(privateOwnership).toEqual(before);
  });

  it('does not link by matching email or matching subject across issuers', async () => {
    const { model, sourceProofs, targetProofs } = fixture();
    const email = 'same-address@example.invalid';
    sourceProofs.set(sourceCredential, { ...source, ...{ email } });
    targetProofs.set(targetCredential, { ...target, subject: source.subject, ...{ email } });
    expect(await model.findAccount(targetIssuer, source.subject)).toBeNull();
    await expect(model.begin(targetCredential)).rejects.toThrow(AuthenticationDenied);
    const ticket = await model.begin(sourceCredential);
    expect(await model.findAccount(targetIssuer, source.subject)).toBeNull();
    await model.complete(ticket, sourceCredential, targetCredential);
    expect(await model.findAccount(targetIssuer, source.subject)).toBe(accountId);
  });

  it('does not provision an unknown source identity', async () => {
    const { model, sourceProofs } = fixture();
    sourceProofs.set(sourceCredential, { ...source, subject: 'unknown' });
    await expect(model.begin(sourceCredential)).rejects.toThrow(AuthenticationDenied);
  });

  it.each(['source', 'target'])(
    'rejects missing or revoked %s proof without linking',
    async side => {
      const { model, sourceProofs, targetProofs } = fixture();
      const ticket = await model.begin(sourceCredential);

      if (side === 'source') {
        sourceProofs.clear();
      } else {
        targetProofs.clear();
      }

      await expect(model.complete(ticket, sourceCredential, targetCredential)).rejects.toEqual(
        new AuthenticationDenied(),
      );
      expect(await model.findAccount(targetIssuer, target.subject)).toBeNull();
    },
  );

  it.each([
    { sessionId: 'another-session' },
    { subject: 'other-source' },
    { expiresAt: initialTime },
    { expiresAt: Number.NaN },
  ])('rejects changed or expired source proof: %j', async change => {
    const { model, sourceProofs } = fixture();
    const ticket = await model.begin(sourceCredential);
    sourceProofs.set(sourceCredential, { ...source, ...change });
    await expect(model.complete(ticket, sourceCredential, targetCredential)).rejects.toThrow(
      AuthenticationDenied,
    );
    expect(await model.findAccount(targetIssuer, target.subject)).toBeNull();
  });

  it.each([
    { issuer: sourceIssuer },
    { subject: linkedSubject },
    { expiresAt: initialTime },
    { sessionId: '' },
    { emailVerified: false },
  ])('rejects a conflicting or invalid target proof: %j', async change => {
    const { model, targetProofs } = fixture();
    const ticket = await model.begin(sourceCredential);

    // Simulate a broken verifier too: runtime defenses must still reject false verification.
    targetProofs.set(targetCredential, { ...target, ...change } as RehearsalIdentityProof);
    await expect(model.complete(ticket, sourceCredential, targetCredential)).rejects.toThrow(
      AuthenticationDenied,
    );
    expect(await model.findAccount(targetIssuer, target.subject)).toBeNull();
    expect(await model.findAccount(targetIssuer, linkedSubject)).toBe('acc_other');
  });

  it('expires the ticket at five minutes even while both credentials remain valid', async () => {
    const { model, advance } = fixture();
    const ticket = await model.begin(sourceCredential);
    advance(300_000);
    await expect(model.complete(ticket, sourceCredential, targetCredential)).rejects.toThrow(
      AuthenticationDenied,
    );
    expect(await model.findAccount(targetIssuer, target.subject)).toBeNull();
  });

  it('does not extend a ticket when the original session credential is refreshed', async () => {
    const { model, sourceProofs, advance } = fixture();
    sourceProofs.set(sourceCredential, { ...source, expiresAt: initialTime + 1000 });
    const ticket = await model.begin(sourceCredential);
    sourceProofs.set(sourceCredential, { ...source });
    advance(1000);
    await expect(model.complete(ticket, sourceCredential, targetCredential)).rejects.toThrow(
      AuthenticationDenied,
    );
  });

  it('rejects fabricated and consumed tickets, including replay towards another identity', async () => {
    const { model, targetProofs } = fixture();
    await expect(model.complete('fake', sourceCredential, targetCredential)).rejects.toThrow(
      AuthenticationDenied,
    );
    const ticket = await model.begin(sourceCredential);
    await model.complete(ticket, sourceCredential, targetCredential);
    targetProofs.set(targetCredential, { ...target, subject: 'different-target' });
    await expect(model.complete(ticket, sourceCredential, targetCredential)).rejects.toThrow(
      AuthenticationDenied,
    );
    expect(await model.findAccount(targetIssuer, 'different-target')).toBeNull();
  });

  it('allows only one completion when two requests race', async () => {
    const { model } = fixture();
    const ticket = await model.begin(sourceCredential);
    const outcomes = await Promise.allSettled([
      model.complete(ticket, sourceCredential, targetCredential),
      model.complete(ticket, sourceCredential, targetCredential),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('rechecks source expiry after waiting for target verification', async () => {
    let time = initialTime;
    const model = new MigrationRehearsal(
      [{ ...source, accountId }],
      targetIssuer,
      vi.fn(() => Promise.resolve({ ...source })),
      vi.fn(() => {
        time = source.expiresAt;

        return Promise.resolve({ ...target, expiresAt: time + 1000 });
      }),
      () => time,
    );
    const ticket = await model.begin(sourceCredential);
    await expect(model.complete(ticket, sourceCredential, targetCredential)).rejects.toThrow(
      AuthenticationDenied,
    );
    expect(await model.findAccount(targetIssuer, target.subject)).toBeNull();
  });
});
