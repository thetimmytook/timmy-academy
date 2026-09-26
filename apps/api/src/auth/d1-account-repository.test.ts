import { readFile } from 'node:fs/promises';

import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { D1AccountRepository } from './d1-account-repository';
import { resolveApplicationPrincipal } from './resolve-principal';

let mf: Miniflare;
let db: D1Database;
const identity = { issuer: 'https://auth.example', subject: 'user_1' };
const repository = (): D1AccountRepository => new D1AccountRepository(db);

async function expectCounts(accounts: number, identities: number): Promise<void> {
  expect(await db.prepare('SELECT count(*) AS n FROM accounts').first('n')).toBe(accounts);
  expect(await db.prepare('SELECT count(*) AS n FROM account_identities').first('n')).toBe(
    identities,
  );
  expect(
    await db
      .prepare(
        `SELECT count(*) AS n FROM accounts a
         WHERE NOT EXISTS (SELECT 1 FROM account_identities i WHERE i.account_id = a.id)`,
      )
      .first('n'),
  ).toBe(0);
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("test"); } }',
      compatibilityDate: '2026-09-19',
      d1Databases: ['BENCHMARK_DB'],
    }),
  );
  db = await mf.getD1Database('BENCHMARK_DB');

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migration = await readFile(
    new URL('../../../../infrastructure/migrations/0002_auth-accounts.sql', import.meta.url),
    'utf8',
  );
  await db.batch(
    migration.split('--> statement-breakpoint').map(statement => db.prepare(statement)),
  );
});

beforeEach(async () => {
  await db.batch([
    db.prepare('DROP TRIGGER IF EXISTS reject_identity'),
    db.prepare('DELETE FROM account_identities'),
    db.prepare('DELETE FROM accounts'),
  ]);
});

afterAll(async () => {
  await mf?.dispose();
});

describe('private D1 account repository', () => {
  it('resolves browser and desktop principals through D1 to the same persistent account', async () => {
    const now = 1_800_000_000_000;
    const principals = await Promise.all(
      (['browser', 'desktop'] as const).map(kind =>
        resolveApplicationPrincipal(
          {
            ...identity,
            emailVerified: true,
            canModerate: false,
            session: { kind, expiresAt: now + 60_000 },
          },
          repository(),
          () => now,
        ),
      ),
    );
    const accountId = await repository().findOrCreateAccount(identity);
    expect(principals).toEqual(
      ['browser', 'desktop'].map(kind => ({
        accountId,
        emailVerified: true,
        canModerate: false,
        session: { kind, expiresAt: now + 60_000 },
      })),
    );
    await expectCounts(1, 1);
  });

  it('persists the account across repeated sign-ins and repository instances', async () => {
    const accountId = await repository().findOrCreateAccount(identity);
    expect(accountId).toEqual(expect.any(String));
    expect(accountId).not.toBe(identity.subject);
    expect(await repository().findOrCreateAccount(identity)).toBe(accountId);
    expect(await db.prepare('SELECT id FROM accounts').first('id')).toBe(accountId);
    expect(await db.prepare('SELECT * FROM account_identities').first()).toEqual({
      ...identity,
      account_id: accountId,
    });
    await expectCounts(1, 1);
  });

  it('uses the exact pair and never merges identities by email or string concatenation', async () => {
    const identities = [
      identity,
      { ...identity, issuer: 'https://other.example' },
      { ...identity, subject: 'user_2' },
      { ...identity, subject: 'USER_1' },
      { issuer: 'a:b', subject: 'c' },
      { issuer: 'a', subject: 'b:c' },
      { issuer: "issuer'", subject: "subject'); --" },
    ].map(value => ({ ...value, email: 'same@example.com' }));
    const ids = await Promise.all(identities.map(value => repository().findOrCreateAccount(value)));
    expect(new Set(ids).size).toBe(identities.length);
    await expectCounts(identities.length, identities.length);
  });

  it('returns one winning account for concurrent first sign-ins without orphan accounts', async () => {
    const ids = await Promise.all(
      Array.from({ length: 24 }, () => repository().findOrCreateAccount(identity)),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await repository().findOrCreateAccount(identity)).toBe(ids[0]);
    await expectCounts(1, 1);
  });

  it('preserves a prelinked account and rolls back a conflicting binding with its new account', async () => {
    const accountId = await repository().findOrCreateAccount(identity);
    await db
      .prepare('INSERT INTO account_identities(issuer, subject, account_id) VALUES (?, ?, ?)')
      .bind('https://new.example', 'migrated_user', accountId)
      .run();

    await expect(
      db.batch([
        db.prepare("INSERT INTO accounts(id) VALUES ('conflicting_account')"),
        db
          .prepare('INSERT INTO account_identities(issuer, subject, account_id) VALUES (?, ?, ?)')
          .bind(identity.issuer, identity.subject, 'conflicting_account'),
      ]),
    ).rejects.toThrow('UNIQUE constraint failed');
    expect(await repository().findOrCreateAccount(identity)).toBe(accountId);
    expect(
      await repository().findOrCreateAccount({
        issuer: 'https://new.example',
        subject: 'migrated_user',
      }),
    ).toBe(accountId);
    await expectCounts(1, 2);
  });

  it('rolls back account creation when the identity write fails and allows a safe retry', async () => {
    await db
      .prepare(
        `CREATE TRIGGER reject_identity BEFORE INSERT ON account_identities
         BEGIN SELECT RAISE(ABORT, 'identity write rejected'); END`,
      )
      .run();
    await expect(repository().findOrCreateAccount(identity)).rejects.toThrow(
      'identity write rejected',
    );
    await expectCounts(0, 0);
    await db.prepare('DROP TRIGGER reject_identity').run();
    await repository().findOrCreateAccount(identity);
    await expectCounts(1, 1);
  });

  it('rejects missing verifier identity fields before writing', async () => {
    await expect(repository().findOrCreateAccount({ ...identity, issuer: '' })).rejects.toThrow(
      'A verified issuer and subject are required.',
    );
    await expect(repository().findOrCreateAccount({ ...identity, subject: '' })).rejects.toThrow(
      'A verified issuer and subject are required.',
    );
    await expectCounts(0, 0);
  });
});
