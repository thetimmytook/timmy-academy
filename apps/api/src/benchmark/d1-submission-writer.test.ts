import { readFile, readdir } from 'node:fs/promises';

import { publicRunDetailSchema } from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { D1BenchmarkRepository } from './d1-repository';
import { D1SubmissionWriter } from './d1-submission-writer';
import { createSyntheticRuns } from './fixtures';
import { normalizeHardware } from './hardware-normalization';
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
    db.prepare('DELETE FROM benchmark_submissions'),
    db.prepare('DELETE FROM benchmark_runs'),
    db.prepare('DELETE FROM accounts'),
    db.prepare('INSERT INTO accounts(id) VALUES (?), (?)').bind(owner, stranger),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe('atomic submission writes', () => {
  it('stores one hidden run and pending submission without exposing private IDs', async () => {
    const receipt = await writer.submit(owner, client, data, requestFingerprint);
    expect(receipt).toEqual({
      client_run_id: client,
      publication_status: 'pending_review',
      public_run_id: null,
      url: null,
    });
    expect(await countRuns()).toBe(1);
    expect(await countSubmissions()).toBe(1);
    const row = await db
      .prepare('SELECT public_id, visibility, published_at, detail FROM benchmark_runs')
      .first<{
        public_id: string;
        visibility: string;
        published_at: string | null;
        detail: string;
      }>();
    expect(row?.visibility).toBe('hidden');
    expect(row?.published_at).toBeNull();
    expect(row?.detail).not.toContain(owner);
    expect(await new D1BenchmarkRepository(db, 'secret').detail(row!.public_id)).toBeUndefined();
  });
  it('replays without changing IDs, timestamps, revision or creating orphan runs', async () => {
    await writer.submit(owner, client, data, requestFingerprint);
    const before = await db.prepare('SELECT * FROM benchmark_submissions').all();
    const revision = await db.prepare('SELECT revision FROM benchmark_state').first('revision');
    const reordered = {
      ...data,
      metrics: Object.fromEntries(Object.entries(data.metrics).reverse()) as typeof data.metrics,
      resource_telemetry: {
        ...data.resource_telemetry,
        cpu: {
          ...data.resource_telemetry.cpu,
          total_utilization: Object.fromEntries(
            Object.entries(data.resource_telemetry.cpu.total_utilization).reverse(),
          ) as typeof data.resource_telemetry.cpu.total_utilization,
        },
      },
    };
    await writer.submit(owner, client, reordered, requestFingerprint);
    expect((await db.prepare('SELECT * FROM benchmark_submissions').all()).results).toEqual(
      before.results,
    );
    expect(await db.prepare('SELECT revision FROM benchmark_state').first('revision')).toBe(
      revision,
    );
    expect(await countRuns()).toBe(1);
  });
  it('serializes simultaneous identical retries from independent repositories', async () => {
    const receipts = await Promise.all(
      Array.from({ length: 8 }, () =>
        new D1SubmissionWriter(db).submit(owner, client, data, requestFingerprint),
      ),
    );
    expect(receipts.every(receipt => JSON.stringify(receipt) === JSON.stringify(receipts[0]))).toBe(
      true,
    );
    expect(await countRuns()).toBe(1);
    expect(await countSubmissions()).toBe(1);
  });
  it('rejects changed content without replacing the original', async () => {
    await writer.submit(owner, client, data, requestFingerprint);
    await expect(
      writer.submit(
        owner,
        client,
        {
          ...data,
          metrics: { ...data.metrics, average_fps: data.metrics.average_fps + 1 },
        },
        requestFingerprint,
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    expect(await countRuns()).toBe(1);
    const stored = await db.prepare('SELECT detail FROM benchmark_runs').first<string>('detail');
    expect(publicRunDetailSchema.parse(JSON.parse(stored!)).metrics).toEqual(data.metrics);
  });
  it('keeps one winner when different payloads race for the same client ID', async () => {
    const results = await Promise.allSettled([
      writer.submit(owner, client, data, requestFingerprint),
      new D1SubmissionWriter(db).submit(
        owner,
        client,
        { ...data, captured_day: '2026-01-01' },
        requestFingerprint,
      ),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'idempotency_conflict' },
    });
    expect(await countRuns()).toBe(1);
    expect(await countSubmissions()).toBe(1);
  });
  it('scopes client IDs to accounts', async () => {
    await Promise.all([
      writer.submit(owner, client, data, requestFingerprint),
      writer.submit(stranger, client, data, requestFingerprint),
    ]);
    expect(await countRuns()).toBe(2);
    expect(await countSubmissions()).toBe(2);
  });
  it('rolls back the run when the submission insert fails', async () => {
    await expect(
      writer.submit('missing_account', client, data, requestFingerprint),
    ).rejects.toThrow();
    expect(await countRuns()).toBe(0);
    expect(await countSubmissions()).toBe(0);
  });
  it('accepts unfamiliar hardware as a pending submission', async () => {
    const hardware = await normalizeHardware({
      cpu_name: 'New CPU 123',
      gpu_name: 'New GPU 456',
      ram_gb: 32,
    });
    expect(
      await writer.submit(owner, client, { ...data, hardware }, requestFingerprint),
    ).toMatchObject({
      publication_status: 'pending_review',
      public_run_id: null,
      url: null,
    });
    expect(await countRuns()).toBe(1);
  });
  it('rejects extra private fields before writing', async () => {
    await expect(
      writer.submit(
        owner,
        client,
        { ...data, email: 'private' } as typeof data,
        requestFingerprint,
      ),
    ).rejects.toThrow();
    await expect(writer.submit(owner, 'invalid', data, requestFingerprint)).rejects.toThrow();
    expect(await countRuns()).toBe(0);
  });
});
