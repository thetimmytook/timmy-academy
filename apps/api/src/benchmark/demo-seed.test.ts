import { readFile, readdir } from 'node:fs/promises';

import { publicRunDetailSchema } from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { mapCatalog } from './catalog';
import { demoSeedRows, demoSeedStatements } from './demo-seed';

import type { PublicRunDetail } from '@timmy/contracts';

const allRowsSql = 'SELECT * FROM benchmark_runs ORDER BY public_id';
const revisionSql = 'SELECT revision FROM benchmark_state';
const submissionsSql = 'SELECT * FROM benchmark_submissions';
let mf: Miniflare;
let db: D1Database;
const sourceRows = demoSeedRows();
const statements = demoSeedStatements();
const firstId = sourceRows[0]!.detail.public_run_id;
const umaId = sourceRows.at(-1)!.detail.public_run_id;

interface SeedRow {
  sequence: number;
  public_id: string;
  contributor_key: string;
  published_at: string | null;
  visibility: string;
  detail: string;
  is_synthetic: number;
}

async function storedRows(): Promise<SeedRow[]> {
  return (await db.prepare(allRowsSql).all<SeedRow>()).results;
}

async function applySeed(): Promise<void> {
  await db.batch(statements.map(statement => db.prepare(statement)));
}

function measurementWithoutTelemetry(row: SeedRow): unknown {
  const document = JSON.parse(row.detail) as Record<string, unknown>;
  delete document.resource_telemetry;

  return document;
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

beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM benchmark_submissions'),
    db.prepare('DELETE FROM accounts'),
    db.prepare('DELETE FROM benchmark_runs'),
  ]);
});

it('seeds 397 valid demo measurements across all 11 maps without changing existing rows on rerun', async () => {
  expect(statements).toHaveLength(397);
  await db.batch(statements.map(statement => db.prepare(statement)));
  const rows = await db
    .prepare('SELECT public_id, detail, is_synthetic FROM benchmark_runs ORDER BY public_id')
    .all<{
      public_id: string;
      detail: string;
      is_synthetic: number;
    }>();
  expect(rows.results).toHaveLength(397);
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

  for (const map of mapCatalog) {
    expect(mapCounts.get(map.id)).toBe(map.id === 'lighthouse' ? 37 : 36);
  }

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
  const before = await db.prepare(allRowsSql).all();
  const revision = await db.prepare(revisionSql).first('revision');
  await db.batch(demoSeedStatements().map(statement => db.prepare(statement)));
  expect((await db.prepare(allRowsSql).all()).results).toEqual(before.results);
  expect(await db.prepare(revisionSql).first('revision')).toBe(revision);
}, 30000);

it('refreshes only telemetry in all 396 older demo rows, preserving IDs, states and other content', async () => {
  await applySeed();
  const hiddenId = sourceRows[1]!.detail.public_run_id;
  const deletedId = sourceRows[2]!.detail.public_run_id;
  await db.batch([
    db.prepare('DELETE FROM benchmark_runs WHERE public_id = ?').bind(umaId),
    db.prepare("UPDATE benchmark_runs SET detail = json_remove(detail, '$.resource_telemetry')"),
    db
      .prepare("UPDATE benchmark_runs SET visibility = 'hidden' WHERE public_id = ?")
      .bind(hiddenId),
    db
      .prepare("UPDATE benchmark_runs SET visibility = 'deleted' WHERE public_id = ?")
      .bind(deletedId),
    db
      .prepare(
        "UPDATE benchmark_runs SET published_at = '2026-09-24T01:02:03Z', detail = json_set(detail, '$.settings.graphics.vsync', json('true'), '$.captured_day', '2026-09-01') WHERE public_id = ?",
      )
      .bind(firstId),
    db
      .prepare(
        "UPDATE benchmark_runs SET detail = json_set(detail, '$.resource_telemetry', json('{\"obsolete\":true}')) WHERE public_id = ?",
      )
      .bind(hiddenId),
    db
      .prepare(
        "UPDATE benchmark_runs SET detail = json_set(detail, '$.resource_telemetry', json('null')) WHERE public_id = ?",
      )
      .bind(deletedId),
  ]);
  const before = await storedRows();
  expect(before).toHaveLength(396);
  const revision = await db.prepare(revisionSql).first<number>('revision');
  await applySeed();
  const after = await storedRows();
  const expected = new Map(
    sourceRows.map(run => [run.detail.public_run_id, run.detail.resource_telemetry]),
  );
  const updated = new Map(after.map(row => [row.public_id, row]));

  for (const old of before) {
    const current = updated.get(old.public_id)!;
    expect({ ...current, detail: old.detail }).toEqual(old);
    expect(measurementWithoutTelemetry(current)).toEqual(measurementWithoutTelemetry(old));
    expect(publicRunDetailSchema.parse(JSON.parse(current.detail)).resource_telemetry).toEqual(
      expected.get(old.public_id),
    );
  }

  expect(after).toHaveLength(397);
  expect(updated.get(hiddenId)?.visibility).toBe('hidden');
  expect(updated.get(deletedId)?.visibility).toBe('deleted');
  expect(await db.prepare(revisionSql).first('revision')).toBe(revision! + 396);
  const refreshedRevision = await db.prepare(revisionSql).first('revision');
  await applySeed();
  expect(await storedRows()).toEqual(after);
  expect(await db.prepare(revisionSql).first('revision')).toBe(refreshedRevision);
}, 30000);

it.each(['non-synthetic', 'foreign contributor', 'linked submission'])(
  'leaves a conflicting %s row unchanged even when it lacks telemetry',
  async protection => {
    await db.prepare(statements[0]!).run();
    await db
      .prepare(
        "UPDATE benchmark_runs SET detail = json_remove(detail, '$.resource_telemetry') WHERE public_id = ?",
      )
      .bind(firstId)
      .run();

    if (protection === 'non-synthetic') {
      await db
        .prepare('UPDATE benchmark_runs SET is_synthetic = 0 WHERE public_id = ?')
        .bind(firstId)
        .run();
    }

    if (protection === 'foreign contributor') {
      await db
        .prepare(
          "UPDATE benchmark_runs SET contributor_key = 'fictional-desktop-foreign' WHERE public_id = ?",
        )
        .bind(firstId)
        .run();
    }

    if (protection === 'linked submission') {
      await db.prepare("INSERT INTO accounts(id) VALUES ('test-owner')").run();
      await db
        .prepare(
          "INSERT INTO benchmark_submissions(account_id, client_run_id, submitted_at, status, run_sequence) SELECT 'test-owner', '00000000-0000-4000-8000-000000000001', '2026-09-26T12:00:00Z', 'published', sequence FROM benchmark_runs WHERE public_id = ?",
        )
        .bind(firstId)
        .run();
    }

    const before = await storedRows();
    const revision = await db.prepare(revisionSql).first('revision');
    const submissions = await db.prepare(submissionsSql).all();
    await db.prepare(statements[0]!).run();
    expect(await storedRows()).toEqual(before);
    expect((await db.prepare(submissionsSql).all()).results).toEqual(submissions.results);
    expect(await db.prepare(revisionSql).first('revision')).toBe(revision);
  },
);

it('does not recreate a missing run whose public ID belongs to a deletion acknowledgement', async () => {
  await db.prepare("INSERT INTO accounts(id) VALUES ('test-owner')").run();
  await db
    .prepare(
      "INSERT INTO benchmark_submissions(account_id, client_run_id, submitted_at, status, deleted_public_id) VALUES ('test-owner', '00000000-0000-4000-8000-000000000001', '2026-09-26T12:00:00Z', 'deleted', ?)",
    )
    .bind(firstId)
    .run();
  const before = await db.prepare(submissionsSql).all();
  await db.prepare(statements[0]!).run();
  await db.prepare(statements[0]!).run();
  expect(await storedRows()).toEqual([]);
  expect((await db.prepare(submissionsSql).all()).results).toEqual(before.results);
});

it('leaves unrelated real and synthetic records outside the generated ID list untouched', async () => {
  const base = sourceRows[0]!.detail;

  for (const [id, synthetic] of [
    ['br_unrelated_real', false],
    ['br_test_desktop_unowned', true],
  ] as const) {
    const detail: PublicRunDetail = {
      ...base,
      public_run_id: id,
      url: `/bench/runs/${id}`,
      is_synthetic: synthetic,
    };
    await db
      .prepare(
        "INSERT INTO benchmark_runs(public_id, contributor_key, published_at, visibility, detail, is_synthetic) VALUES (?, 'fictional-desktop-0-0', '2026-09-26T12:00:00Z', 'hidden', ?, ?)",
      )
      .bind(id, JSON.stringify(detail), synthetic ? 1 : 0)
      .run();
  }

  const before = await storedRows();
  await applySeed();
  const after = new Map((await storedRows()).map(row => [row.public_id, row]));

  for (const old of before) {
    expect(after.get(old.public_id)).toEqual(old);
  }
}, 30000);
