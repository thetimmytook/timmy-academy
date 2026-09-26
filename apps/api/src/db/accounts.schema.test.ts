import { readFile } from 'node:fs/promises';

import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let mf: Miniflare;
let db: D1Database;

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

  for (const statement of migration.split('--> statement-breakpoint')) {
    await db.prepare(statement).run();
  }
});

afterAll(async () => {
  await mf?.dispose();
});

describe('private account identity schema', () => {
  it('allows several provider identities for one account, but rejects reassignment and orphan identities', async () => {
    await db.prepare("INSERT INTO accounts(id) VALUES ('acc_1')").run();
    await db.prepare("INSERT INTO accounts(id) VALUES ('acc_2')").run();

    const link = (issuer: string, subject: string, accountId: string): Promise<D1Result> =>
      db
        .prepare('INSERT INTO account_identities(issuer, subject, account_id) VALUES (?, ?, ?)')
        .bind(issuer, subject, accountId)
        .run();

    await link('https://old.example', 'user_1', 'acc_1');
    await link('https://new.example', 'user_1', 'acc_1');
    await expect(link('https://old.example', 'user_1', 'acc_2')).rejects.toThrow();
    await expect(link('https://new.example', 'user_2', 'missing')).rejects.toThrow();
  });
});
