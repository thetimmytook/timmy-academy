import { readFile, readdir } from 'node:fs/promises';

import { publicRunDetailSchema } from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { D1BenchmarkRepository } from './d1-repository';
import { D1SubmissionApproval } from './d1-submission-approval';
import { D1SubmissionRepository } from './d1-submission-repository';
import { D1SubmissionWriter } from './d1-submission-writer';
import { createSyntheticRuns } from './fixtures';
let mf: Miniflare;
let db: D1Database;
let writer: D1SubmissionWriter;
const requestFingerprint = 'test-request-fingerprint';
const owner = 'acc_owner';
const stranger = 'acc_stranger';
const client = '00000000-0000-4000-8000-000000000001';
const data = publicRunDetailSchema
  .omit({ public_run_id: true, url: true })
  .strip()
  .parse(createSyntheticRuns()[0]!.detail);
const countRuns = async (): Promise<number | null> =>
  db.prepare('SELECT COUNT(*) AS count FROM benchmark_runs').first<number>('count');
const countSubmissions = async (): Promise<number | null> =>
  db.prepare('SELECT COUNT(*) AS count FROM benchmark_submissions').first<number>('count');
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
  writer = new D1SubmissionWriter(db);
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

beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM benchmark_submissions'),
    db.prepare('DELETE FROM benchmark_runs'),
    db.prepare('DELETE FROM accounts'),
    db.prepare('INSERT INTO accounts(id) VALUES (?), (?)').bind(owner, stranger),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

async function pending(): Promise<number> {
  await writer.submit(owner, client, data, requestFingerprint);

  return (await db
    .prepare('SELECT sequence FROM benchmark_submissions')
    .first<number>('sequence'))!;
}

async function revision(): Promise<number | null> {
  return db.prepare('SELECT revision FROM benchmark_state').first<number>('revision');
}

const approval = (): D1SubmissionApproval => new D1SubmissionApproval(db);

describe('atomic submission approval', () => {
  it('publishes the existing run and exposes the owner link without changing measured data', async () => {
    const id = await pending();
    const before = await db.prepare('SELECT detail FROM benchmark_runs').first<string>('detail');
    const result = await approval().approve(id);
    expect(result).toBeDefined();
    expect(result?.publishedAt).toBeTruthy();
    expect(await db.prepare('SELECT detail FROM benchmark_runs').first('detail')).toBe(before);
    const publicRun = await new D1BenchmarkRepository(db, 'secret').detail(result!.publicRunId);
    expect(publicRun).toEqual(JSON.parse(before!));
    const serialized = JSON.stringify(publicRun);

    for (const value of [owner, client, requestFingerprint]) {
      expect(serialized).not.toContain(value);
    }

    expect(await new D1SubmissionRepository(db).findByClientId(owner, client)).toMatchObject({
      publication_status: 'published',
      public_run_id: result!.publicRunId,
      url: '/bench/runs/' + result!.publicRunId,
    });
    expect(await countRuns()).toBe(1);
    expect(await countSubmissions()).toBe(1);
  });
  it('makes repeated approval a no-op, preserving publication time and revision', async () => {
    const id = await pending();
    const oldRevision = await revision();
    const first = await approval().approve(id);
    const publishedRevision = await revision();
    expect(publishedRevision).toBeGreaterThan(oldRevision!);
    expect(await approval().approve(id)).toEqual(first);
    expect(await revision()).toBe(publishedRevision);
  });
  it('serializes concurrent approvals and submission retries', async () => {
    const id = await pending();
    const [first, second, receipt] = await Promise.all([
      approval().approve(id),
      approval().approve(id),
      writer.submit(owner, client, data, requestFingerprint),
    ]);
    expect(first).toEqual(second);
    expect(['pending_review', 'published']).toContain(receipt.publication_status);
    expect(await writer.submit(owner, client, data, requestFingerprint)).toMatchObject({
      publication_status: 'published',
      public_run_id: first!.publicRunId,
    });
    expect(await countRuns()).toBe(1);
    expect(await countSubmissions()).toBe(1);
  });
  it('does not mutate a submission when its ID is absent', async () => {
    const id = await pending();
    const before = await revision();
    expect(await approval().approve(id + 1)).toBeUndefined();
    expect(await revision()).toBe(before);
    expect(await new D1SubmissionRepository(db).findByClientId(owner, client)).toMatchObject({
      publication_status: 'pending_review',
    });
  });
  it('rolls back visibility, timestamp and revision when the status update fails', async () => {
    const id = await pending();
    const before = await revision();
    await db
      .prepare(
        "CREATE TRIGGER fail_approval BEFORE UPDATE OF status ON benchmark_submissions BEGIN SELECT RAISE(ABORT, 'test failure'); END",
      )
      .run();

    try {
      await expect(approval().approve(id)).rejects.toThrow();
    } finally {
      await db.prepare('DROP TRIGGER fail_approval').run();
    }

    expect(await db.prepare('SELECT visibility, published_at FROM benchmark_runs').first()).toEqual(
      { visibility: 'hidden', published_at: null },
    );
    expect(await db.prepare('SELECT status FROM benchmark_submissions').first('status')).toBe(
      'pending_review',
    );
    expect(await revision()).toBe(before);
    expect(await countRuns()).toBe(1);
    expect(await countSubmissions()).toBe(1);
  });
});
