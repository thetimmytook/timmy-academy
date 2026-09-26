import { readFile, readdir } from 'node:fs/promises';

import { publicRunDetailSchema, runSearchQuerySchema, cohortQuerySchema } from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { projectArchivedMeasurement } from './archived-measurement';
import { D1BenchmarkRepository } from './d1-repository';
import { D1SubmissionApproval } from './d1-submission-approval';
import { D1SubmissionDeletion } from './d1-submission-deletion';
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

const approval = (): D1SubmissionApproval => new D1SubmissionApproval(db);

async function published(): Promise<string> {
  return (await approval().approve(await pending()))!.publicRunId;
}

function deletion(): D1SubmissionDeletion {
  return new D1SubmissionDeletion(db);
}

async function archives(): Promise<{ id: string; detail: string }[]> {
  return (
    await db
      .prepare('SELECT id, detail FROM benchmark_measurement_archive')
      .all<{ id: string; detail: string }>()
  ).results;
}

describe('atomic owner publication deletion', () => {
  it('retains only the measurement, removes public data and leaves an unlinked acknowledgement', async () => {
    const publicId = await published();
    const receipt = await deletion().delete(owner, publicId);
    expect(receipt).toEqual({ publication_status: 'deleted', public_run_id: publicId });
    const archived = await archives();
    expect(archived).toHaveLength(1);
    expect(archived[0]!.id).not.toBe(publicId);
    expect(JSON.parse(archived[0]!.detail)).toEqual(
      projectArchivedMeasurement({
        ...data,
        is_synthetic: false,
        public_run_id: publicId,
        url: '/bench/runs/' + publicId,
      }),
    );

    for (const value of [publicId, owner, client, requestFingerprint, data.captured_day]) {
      expect(archived[0]!.detail).not.toContain(value);
    }

    expect(await countRuns()).toBe(0);
    expect(await countSubmissions()).toBe(1);
    const marker = await db.prepare('SELECT * FROM benchmark_submissions').first();
    expect(marker).toMatchObject({
      account_id: owner,
      client_run_id: client,
      status: 'deleted',
      run_sequence: null,
      request_fingerprint: null,
      deleted_public_id: publicId,
    });
    expect(JSON.stringify(marker)).not.toContain(archived[0]!.id);
    const reader = new D1SubmissionRepository(db);
    expect(await reader.findByClientId(owner, client)).toEqual({
      client_run_id: client,
      publication_status: 'deleted',
      public_run_id: null,
      url: null,
    });
    expect((await reader.list(owner)).items).toEqual([]);
    const publicReader = new D1BenchmarkRepository(db, 'secret');
    expect(await publicReader.detail(publicId)).toBeUndefined();
    expect(await publicReader.search(runSearchQuerySchema.parse({}))).toMatchObject({
      summary: { run_count: 0 },
      groups: [],
    });
    expect(await publicReader.filterOptions()).toMatchObject({ cpus: [], gpus: [] });
    expect(
      await publicReader.cohort(
        cohortQuerySchema.parse({
          hardware: {
            cpu_name: data.hardware.cpu.name,
            gpu_name: data.hardware.gpu.name,
            ram_gb: data.hardware.ram_gb,
          },
          map: data.conditions.map.id,
          execution: data.conditions.execution,
          game_resolution: data.conditions.game_resolution,
          game_version: data.conditions.game_version,
        }),
      ),
    ).toMatchObject({ status: 'no_data', runs: [] });
  });
  it('repeats deletion without another archive record or revision change', async () => {
    const publicId = await published();
    const before = await revision();
    const receipt = await deletion().delete(owner, publicId);
    const changed = await revision();
    expect(changed).toBeGreaterThan(before!);
    const firstArchive = await archives();
    expect(await deletion().delete(owner, publicId)).toEqual(receipt);
    expect(await archives()).toEqual(firstArchive);
    expect(await revision()).toBe(changed);
  });
  it('serializes simultaneous deletions into one archive record', async () => {
    const publicId = await published();
    const receipts = await Promise.all(
      Array.from({ length: 6 }, () => deletion().delete(owner, publicId)),
    );
    expect(receipts.every(receipt => receipt.public_run_id === publicId)).toBe(true);
    expect(await archives()).toHaveLength(1);
    expect(await countRuns()).toBe(0);
  });
  it('denies other owners before and after deletion', async () => {
    const publicId = await published();
    await expect(deletion().delete(stranger, publicId)).rejects.toMatchObject({
      code: 'not_owner',
      status: 403,
    });
    expect(await countRuns()).toBe(1);
    expect(await archives()).toEqual([]);
    await deletion().delete(owner, publicId);
    await expect(deletion().delete(stranger, publicId)).rejects.toMatchObject({
      code: 'not_owner',
    });
    expect(await archives()).toHaveLength(1);
  });
  it('does not delete missing or unpublished runs', async () => {
    await pending();
    const publicId = (await db
      .prepare('SELECT public_id FROM benchmark_runs')
      .first<string>('public_id'))!;

    for (const id of [publicId, 'br_missing']) {
      await expect(deletion().delete(owner, id)).rejects.toMatchObject({ code: 'not_found' });
    }

    expect(await countRuns()).toBe(1);
    expect(await archives()).toEqual([]);
  });
  it('blocks resubmission with the deleted client ID even when the payload changes', async () => {
    await deletion().delete(owner, await published());

    for (const fingerprint of [requestFingerprint, 'different-fingerprint']) {
      await expect(writer.submit(owner, client, data, fingerprint)).rejects.toMatchObject({
        code: 'publication_deleted',
        status: 409,
      });
    }

    expect(await countRuns()).toBe(0);
    expect(await archives()).toHaveLength(1);
  });
  it.each([
    'BEFORE INSERT ON benchmark_measurement_archive',
    'BEFORE UPDATE OF status ON benchmark_submissions',
    'BEFORE DELETE ON benchmark_runs',
  ])('rolls back the entire operation on failure %s', async operation => {
    const publicId = await published();
    const before = await revision();

    // Fixed test cases, never request input.
    await db
      .prepare(
        'CREATE TRIGGER fail_deletion ' +
          operation +
          " BEGIN SELECT RAISE(ABORT, 'test failure'); END",
      )
      .run();

    try {
      await expect(deletion().delete(owner, publicId)).rejects.toThrow();
    } finally {
      await db.prepare('DROP TRIGGER fail_deletion').run();
    }

    expect(await archives()).toEqual([]);
    expect(await countRuns()).toBe(1);
    expect(
      await db
        .prepare(
          'SELECT status, run_sequence, request_fingerprint, deleted_public_id FROM benchmark_submissions',
        )
        .first(),
    ).toMatchObject({
      status: 'published',
      request_fingerprint: requestFingerprint,
      deleted_public_id: null,
    });
    expect(await new D1BenchmarkRepository(db, 'secret').detail(publicId)).toBeDefined();
    expect(await revision()).toBe(before);
  });
});
