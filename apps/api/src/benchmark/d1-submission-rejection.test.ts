import { readFile, readdir } from 'node:fs/promises';

import { publicRunDetailSchema } from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { D1BenchmarkRepository } from './d1-repository';
import { D1SubmissionApproval } from './d1-submission-approval';
import { D1SubmissionDeletion } from './d1-submission-deletion';
import { D1SubmissionRejection } from './d1-submission-rejection';
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
  .omit({ public_run_id: true, url: true, is_synthetic: true })
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
    db.prepare('DELETE FROM benchmark_measurement_archive'),
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

const rejection = (): D1SubmissionRejection => new D1SubmissionRejection(db);

describe('submission rejection', () => {
  it('keeps the measurement hidden and unchanged, with an owner-only rejected status', async () => {
    const id = await pending();
    const run = await db.prepare('SELECT * FROM benchmark_runs').first();
    const before = await db.prepare('SELECT * FROM benchmark_submissions').first();
    expect(await rejection().reject(id)).toEqual({ status: 'rejected' });
    expect(await db.prepare('SELECT * FROM benchmark_runs').first()).toEqual(run);
    expect(await db.prepare('SELECT * FROM benchmark_submissions').first()).toEqual({
      ...before,
      status: 'rejected',
      status_reason: 'rejected',
    });
    const repository = new D1SubmissionRepository(db);
    expect(await repository.findByClientId(owner, client)).toMatchObject({
      publication_status: 'rejected',
      public_run_id: null,
      url: null,
      status_reason: 'rejected',
    });
    expect(await repository.findByClientId(stranger, client)).toBeUndefined();
    expect((await repository.list(owner, { status: 'rejected' })).items).toHaveLength(1);
    expect((await repository.list(owner, { status: 'pending_review' })).items).toHaveLength(0);
    expect(
      await new D1BenchmarkRepository(db, 'secret').detail(String(run!.public_id)),
    ).toBeUndefined();
    expect(await countRuns()).toBe(1);
    expect(await countSubmissions()).toBe(1);
  });

  it('makes repeated rejection a no-op and preserves exact upload retries', async () => {
    const id = await pending();
    await rejection().reject(id);
    const before = await revision();
    expect(await rejection().reject(id)).toEqual({ status: 'rejected' });
    expect(await writer.submit(owner, client, data, requestFingerprint)).toEqual({
      client_run_id: client,
      publication_status: 'rejected',
      public_run_id: null,
      url: null,
      status_reason: 'rejected',
    });
    await expect(writer.submit(owner, client, data, 'changed')).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(await revision()).toBe(before);
    expect(await countRuns()).toBe(1);
  });

  it('serializes concurrent rejections and upload retries', async () => {
    const id = await pending();
    const [first, second, retry] = await Promise.all([
      rejection().reject(id),
      rejection().reject(id),
      writer.submit(owner, client, data, requestFingerprint),
    ]);
    expect(first).toEqual(second);
    expect(['pending_review', 'rejected']).toContain(retry.publication_status);
    expect((await writer.submit(owner, client, data, requestFingerprint)).publication_status).toBe(
      'rejected',
    );
    expect(await countRuns()).toBe(1);
    expect(await countSubmissions()).toBe(1);
  });

  it('allows only one decision when approval races with rejection', async () => {
    const id = await pending();
    const results = await Promise.allSettled([
      new D1SubmissionApproval(db).approve(id),
      rejection().reject(id),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const status = await db.prepare('SELECT status FROM benchmark_submissions').first('status');
    const run = await db.prepare('SELECT visibility, published_at FROM benchmark_runs').first();

    if (status === 'published') {
      expect(run?.visibility).toBe('published');
      expect(run?.published_at).toBeTruthy();
    } else {
      expect(status).toBe('rejected');
      expect(run).toEqual({ visibility: 'hidden', published_at: null });
    }
  });

  it('does not approve a rejected submission', async () => {
    const id = await pending();
    await rejection().reject(id);
    const before = await revision();
    await expect(new D1SubmissionApproval(db).approve(id)).rejects.toThrow();
    expect(await revision()).toBe(before);
    expect(await db.prepare('SELECT visibility FROM benchmark_runs').first('visibility')).toBe(
      'hidden',
    );
  });

  it('does not reject published or deleted submissions', async () => {
    const id = await pending();
    const publication = (await new D1SubmissionApproval(db).approve(id))!;
    const publishedRevision = await revision();
    await expect(rejection().reject(id)).rejects.toThrow();
    expect(await revision()).toBe(publishedRevision);
    await new D1SubmissionDeletion(db).delete(owner, publication.publicRunId);
    const deletedRevision = await revision();
    await expect(rejection().reject(id)).rejects.toThrow();
    expect(await revision()).toBe(deletedRevision);
    expect(await countRuns()).toBe(0);
  });

  it('leaves records unchanged when the ID is absent', async () => {
    const id = await pending();
    const before = await revision();
    expect(await rejection().reject(id + 1)).toBeUndefined();
    expect(await revision()).toBe(before);
  });

  it('rolls back the status and revision when the update fails', async () => {
    const id = await pending();
    const before = await revision();
    await db
      .prepare(
        "CREATE TRIGGER fail_rejection AFTER UPDATE OF status ON benchmark_submissions BEGIN SELECT RAISE(ABORT, 'test failure'); END",
      )
      .run();

    try {
      await expect(rejection().reject(id)).rejects.toThrow();
    } finally {
      await db.prepare('DROP TRIGGER fail_rejection').run();
    }

    expect(
      await db.prepare('SELECT status, status_reason FROM benchmark_submissions').first(),
    ).toEqual({ status: 'pending_review', status_reason: null });
    expect(await revision()).toBe(before);
  });
});
