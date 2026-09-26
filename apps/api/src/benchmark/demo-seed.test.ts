import { readFile, readdir } from 'node:fs/promises';

import { publicRunDetailSchema } from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { mapCatalog } from './catalog';
import { demoSeedStatements } from './demo-seed';

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
  const directory = new URL('../../../../infrastructure/migrations/', import.meta.url);

  // Repository-owned migration directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const files = (await readdir(directory))
    .filter(file => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const migration = await readFile(new URL(file, directory), 'utf8');

    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) {
        await db.prepare(statement).run();
      }
    }
  }
}, 30000);

afterAll(async () => {
  await mf?.dispose();
});

it('seeds 396 valid demo measurements across all 11 maps without overwriting existing records', async () => {
  const statements = demoSeedStatements();
  expect(statements).toHaveLength(396);
  await db.batch(statements.map(statement => db.prepare(statement)));
  const rows = await db
    .prepare('SELECT public_id, detail, is_synthetic FROM benchmark_runs ORDER BY public_id')
    .all<{
      public_id: string;
      detail: string;
      is_synthetic: number;
    }>();
  expect(rows.results).toHaveLength(396);
  const mapCounts = new Map<string, number>();

  for (const row of rows.results) {
    const detail = publicRunDetailSchema.parse(JSON.parse(row.detail));
    expect(row.is_synthetic).toBe(1);
    expect(detail.is_synthetic).toBe(true);
    expect(detail.public_run_id).toBe(row.public_id);
    mapCounts.set(detail.conditions.map.id, (mapCounts.get(detail.conditions.map.id) ?? 0) + 1);
  }

  expect([...mapCounts.keys()].sort((a, b) => a.localeCompare(b))).toEqual(
    mapCatalog.map(map => map.id).sort((a, b) => a.localeCompare(b)),
  );
  expect([...mapCounts.values()]).toEqual(Array<number>(11).fill(36));

  const ids = rows.results.slice(0, 3).map(row => row.public_id);

  // A conflicting non-demo record and previously hidden/deleted demo rows must survive unchanged.
  await db.batch([
    db
      .prepare(
        "UPDATE benchmark_runs SET is_synthetic = 0, contributor_key = 'real-account', detail = json_set(detail, '$.is_synthetic', json('false')) WHERE public_id = ?",
      )
      .bind(ids[0]),
    db.prepare("UPDATE benchmark_runs SET visibility = 'hidden' WHERE public_id = ?").bind(ids[1]),
    db.prepare("UPDATE benchmark_runs SET visibility = 'deleted' WHERE public_id = ?").bind(ids[2]),
  ]);
  const before = await db.prepare('SELECT * FROM benchmark_runs ORDER BY public_id').all();
  const revision = await db.prepare('SELECT revision FROM benchmark_state').first('revision');
  await db.batch(demoSeedStatements().map(statement => db.prepare(statement)));
  expect(
    (await db.prepare('SELECT * FROM benchmark_runs ORDER BY public_id').all()).results,
  ).toEqual(before.results);
  expect(await db.prepare('SELECT revision FROM benchmark_state').first('revision')).toBe(revision);
}, 30000);
