import { readFile, readdir } from 'node:fs/promises';

import { cohortQuerySchema, runSearchQuerySchema } from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { D1BenchmarkRepository } from '../benchmark/d1-repository';
import { createSyntheticRuns } from '../benchmark/fixtures';

let mf: Miniflare;
let db: D1Database;
const run = createSyntheticRuns()[0]!;
const owner = 'acc_owner';
const otherOwner = 'acc_other';
const clientId = 'client_run_1';
const revisionQuery = 'SELECT revision FROM benchmark_state WHERE id = 1';
const deleteRun = 'DELETE FROM benchmark_runs WHERE sequence = ?';
const countSubmissions = 'SELECT count(*) AS count FROM benchmark_submissions';
const submittedAt = '2026-09-23T10:00:00Z';
let firstRun: number;
let secondRun: number;

async function createRun(id: string): Promise<number> {
  const detail = { ...run.detail, public_run_id: id, url: '/bench/runs/' + id };

  if (id === 'br_other') {
    detail.hardware = { ...detail.hardware, cpu: { id: 'private-cpu', name: 'Private CPU' } };
  }

  await db
    .prepare(
      'INSERT INTO benchmark_runs(public_id, contributor_key, visibility, detail) VALUES (?, ?, ?, ?)',
    )
    .bind(id, 'private_contributor', 'hidden', JSON.stringify(detail))
    .run();

  return (await db
    .prepare('SELECT sequence FROM benchmark_runs WHERE public_id = ?')
    .bind(id)
    .first<number>('sequence'))!;
}

interface Submission {
  accountId: string;
  clientRunId: string;
  status: string;
  runSequence: number | null;
  reason: string | null;
}

function insert(overrides: Partial<Submission> = {}): Promise<D1Result> {
  const row: Submission = {
    accountId: owner,
    clientRunId: clientId,
    status: 'pending_review',
    runSequence: firstRun,
    reason: null,
    ...overrides,
  };

  return db
    .prepare(
      'INSERT INTO benchmark_submissions (account_id, client_run_id, submitted_at, status, run_sequence, status_reason) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(row.accountId, row.clientRunId, submittedAt, row.status, row.runSequence, row.reason)
    .run();
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

  // Repository migration directory only.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const files = (await readdir(directory))
    .filter(file => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    // Fixed repository migrations, not user-controlled paths.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const migration = await readFile(new URL(file, directory), 'utf8');

    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) {
        await db.prepare(statement).run();
      }
    }

    if (file.startsWith('0000_')) {
      await db
        .prepare(
          'INSERT INTO benchmark_runs(public_id, contributor_key, published_at, detail) VALUES (?, ?, ?, ?)',
        )
        .bind(
          run.detail.public_run_id,
          run.contributor,
          run.publishedAt,
          JSON.stringify(run.detail),
        )
        .run();
    }
  }
});

beforeEach(async () => {
  await db.prepare('DELETE FROM benchmark_submissions').run();
  await db.prepare('DELETE FROM accounts').run();
  await db
    .prepare('DELETE FROM benchmark_runs WHERE public_id <> ?')
    .bind(run.detail.public_run_id)
    .run();
  firstRun = await createRun('br_pending');
  secondRun = await createRun('br_other');
  await db.prepare('INSERT INTO accounts(id) VALUES (?), (?)').bind(owner, otherOwner).run();
});

afterAll(async () => {
  await mf?.dispose();
});

describe('private benchmark submission schema', () => {
  it('preserves existing public data and its generated columns through migration', async () => {
    const stored = await db
      .prepare('SELECT detail, cpu FROM benchmark_runs WHERE public_id = ?')
      .bind(run.detail.public_run_id)
      .first<{ detail: string; cpu: string }>();
    expect(JSON.parse(stored!.detail)).toEqual(run.detail);
    expect(stored!.cpu).toBe(run.detail.hardware.cpu.id);
    expect(await db.prepare(countSubmissions).first('count')).toBe(0);
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });

  it('allows a client ID in different accounts but only once within each account', async () => {
    await insert();
    await insert({ accountId: otherOwner, runSequence: secondRun });
    await expect(insert({ runSequence: secondRun })).rejects.toThrow();
    expect(await db.prepare(countSubmissions).first('count')).toBe(2);
  });

  it('rejects concurrent duplicate submissions', async () => {
    const results = await Promise.allSettled([insert(), insert({ runSequence: secondRun })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.prepare(countSubmissions).first('count')).toBe(1);
  });

  it('requires an existing owner and run, and gives a run only one owner', async () => {
    await expect(insert({ accountId: 'missing' })).rejects.toThrow();
    await expect(insert({ runSequence: -1 })).rejects.toThrow();
    await insert();
    await expect(insert({ accountId: otherOwner })).rejects.toThrow();
    await expect(
      db.prepare('DELETE FROM accounts WHERE id = ?').bind(owner).run(),
    ).rejects.toThrow();
    await expect(db.prepare(deleteRun).bind(firstRun).run()).rejects.toThrow();
  });

  it.each<Partial<Submission>>([
    { status: 'unknown' },
    { runSequence: null },
    { status: 'published', runSequence: null },
    { status: 'rejected' },
    { status: 'rejected', reason: '   ' },
    { reason: 'fixture_reason' },
    { status: 'deleted' },
  ])('rejects inconsistent metadata: %j', async invalid => {
    await expect(insert(invalid)).rejects.toThrow();
  });

  it.each(['pending_review', 'rejected'])(
    'keeps full %s run data private across public reads',
    async status => {
      await insert({ status, reason: status === 'rejected' ? 'fixture_reason' : null });
      const repository = new D1BenchmarkRepository(db, 'test-signing-secret');
      expect(await repository.detail('br_pending')).toBeUndefined();
      const search = await repository.search(runSearchQuerySchema.parse({}));
      expect(JSON.stringify(search)).not.toContain('br_pending');

      if (search.view === 'groups') {
        expect(search.summary.run_count).toBe(1);
      }

      const comparison = cohortQuerySchema.parse({
        hardware: {
          cpu_name: run.detail.hardware.cpu.name,
          gpu_name: run.detail.hardware.gpu.name,
          ram_gb: run.detail.hardware.ram_gb,
        },
        map: run.detail.conditions.map.id,
        execution: run.detail.conditions.execution,
        game_resolution: run.detail.conditions.game_resolution,
        game_version: run.detail.conditions.game_version,
      });
      const cohort = await repository.cohort(comparison);
      expect(JSON.stringify(cohort)).not.toContain('br_pending');
      const options = await repository.filterOptions();
      await db.prepare('DELETE FROM benchmark_submissions').run();
      await db.prepare('DELETE FROM benchmark_runs WHERE visibility = ?').bind('hidden').run();
      expect(await repository.filterOptions()).toEqual(options);
      expect(await repository.cohort(comparison)).toEqual(cohort);
    },
  );

  it('publishes the same detail row without copying it and restores revision triggers', async () => {
    await insert();
    const before = await db
      .prepare('SELECT detail FROM benchmark_runs WHERE sequence = ?')
      .bind(firstRun)
      .first('detail');
    const revision = (await db.prepare(revisionQuery).first<number>('revision'))!;
    await db.batch([
      db
        .prepare(
          "UPDATE benchmark_runs SET visibility = 'published', published_at = ? WHERE sequence = ?",
        )
        .bind(submittedAt, firstRun),
      db
        .prepare("UPDATE benchmark_submissions SET status = 'published' WHERE run_sequence = ?")
        .bind(firstRun),
    ]);
    const repository = new D1BenchmarkRepository(db, 'test-signing-secret');
    expect((await repository.detail('br_pending'))?.settings).toEqual(run.detail.settings);
    expect(
      await db
        .prepare('SELECT detail FROM benchmark_runs WHERE sequence = ?')
        .bind(firstRun)
        .first('detail'),
    ).toBe(before);
    expect(await db.prepare(revisionQuery).first('revision')).toBe(revision + 1);
    await db.prepare(deleteRun).bind(secondRun).run();
    expect(await db.prepare(revisionQuery).first('revision')).toBe(revision + 2);
  });

  it('requires a publication time before a run becomes visible', async () => {
    await expect(
      db
        .prepare("UPDATE benchmark_runs SET visibility = 'published' WHERE sequence = ?")
        .bind(firstRun)
        .run(),
    ).rejects.toThrow();
  });

  it('retains a deleted client ID without retaining a link to measurement data', async () => {
    await insert();
    await db
      .prepare(
        "UPDATE benchmark_submissions SET status = 'deleted', run_sequence = NULL WHERE account_id = ?",
      )
      .bind(owner)
      .run();
    await db.prepare(deleteRun).bind(firstRun).run();
    await expect(insert({ runSequence: secondRun })).rejects.toThrow();
    expect(
      await db.prepare('SELECT run_sequence FROM benchmark_submissions').first('run_sequence'),
    ).toBeNull();
  });

  it('orders submissions deterministically when server timestamps match', async () => {
    await insert();
    await insert({ clientRunId: 'client_run_2', runSequence: secondRun });
    const result = await db
      .prepare(
        'SELECT client_run_id FROM benchmark_submissions WHERE account_id = ? ORDER BY submitted_at DESC, sequence DESC',
      )
      .bind(owner)
      .all<{ client_run_id: string }>();
    expect(result.results.map(row => row.client_run_id)).toEqual(['client_run_2', clientId]);
  });
});
