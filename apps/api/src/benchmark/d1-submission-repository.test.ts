import { readFile, readdir } from 'node:fs/promises';

import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { D1SubmissionRepository } from './d1-submission-repository';
import { createSyntheticRuns } from './fixtures';

import type { SubmissionStatus } from './d1-submission-repository';

let mf: Miniflare;
let db: D1Database;
let repository: D1SubmissionRepository;
const owner = 'acc_owner';
const stranger = 'acc_stranger';
const fixture = createSyntheticRuns()[0]!.detail;
const submittedAt = '2026-09-23T12:00:00Z';

async function insert(
  account: string,
  client: string,
  status: SubmissionStatus | 'deleted',
  time = submittedAt,
): Promise<void> {
  const id = `br_${account}_${client}`;
  let sequence: number | null = null;

  if (status !== 'deleted') {
    const detail = { ...fixture, public_run_id: id, url: `/bench/runs/${id}` };
    await db
      .prepare(
        'INSERT INTO benchmark_runs(public_id, contributor_key, published_at, visibility, detail) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        id,
        'private_contributor',
        status === 'published' ? time : null,
        status === 'published' ? 'published' : 'hidden',
        JSON.stringify(detail),
      )
      .run();
    sequence = await db
      .prepare('SELECT sequence FROM benchmark_runs WHERE public_id = ?')
      .bind(id)
      .first<number>('sequence');
  }

  await db
    .prepare(
      'INSERT INTO benchmark_submissions(account_id, client_run_id, submitted_at, status, run_sequence, status_reason) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(account, client, time, status, sequence, status === 'rejected' ? 'fixture_reason' : null)
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
  repository = new D1SubmissionRepository(db);
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

describe('private D1 submission reads', () => {
  it('isolates accounts even when they use the same client ID', async () => {
    await insert(owner, 'shared', 'pending_review');
    await insert(stranger, 'shared', 'published');
    await insert(stranger, 'other', 'published');
    const own = await repository.findByClientId(owner, 'shared');
    expect(own?.publication_status).toBe('pending_review');
    expect(own?.public_run_id).toBeNull();
    expect((await repository.findByClientId(stranger, 'shared'))?.publication_status).toBe(
      'published',
    );
    expect(await repository.findByClientId(owner, 'other')).toBeUndefined();
    expect(await repository.findByClientId(owner, 'missing')).toBeUndefined();
    expect((await repository.list(owner)).items.map(item => item.client_run_id)).toEqual([
      'shared',
    ]);
    expect(await repository.list('missing_account')).toEqual({ items: [], next: null });
  });

  it('projects cards from detail and omits private metadata, settings and unpublished IDs', async () => {
    await insert(owner, 'pending', 'pending_review');
    const item = await repository.findByClientId(owner, 'pending');
    expect(item).toEqual({
      client_run_id: 'pending',
      publication_status: 'pending_review',
      public_run_id: null,
      url: null,
      submitted_at: submittedAt,
      captured_day: fixture.captured_day,
      hardware: {
        cpu: fixture.hardware.cpu.name,
        gpu: fixture.hardware.gpu.name,
        ram_gb: fixture.hardware.ram_gb,
      },
      map: fixture.conditions.map,
      execution: fixture.conditions.execution,
      game_resolution: fixture.conditions.game_resolution,
      metrics: {
        average_fps: fixture.metrics.average_fps,
        one_percent_low_fps: fixture.metrics.one_percent_low_fps,
      },
      status_reason: null,
    });
    const text = JSON.stringify(item);

    for (const privateValue of [
      owner,
      'br_acc_owner_pending',
      'private_contributor',
      'settings',
      'sequence',
      'issuer',
      'subject',
    ]) {
      expect(text).not.toContain(privateValue);
    }
  });

  it.each(['published', 'pending_review', 'rejected'] as const)(
    'filters only the requested owner status: %s',
    async status => {
      for (const state of ['published', 'pending_review', 'rejected'] as const) {
        await insert(owner, state, state);
      }

      await insert(stranger, 'foreign', status);
      const page = await repository.list(owner, { status });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.publication_status).toBe(status);
      expect(page.items[0]?.url !== null).toBe(status === 'published');
      expect(page.items[0]?.status_reason).toBe(status === 'rejected' ? 'fixture_reason' : null);
    },
  );

  it('excludes deleted submissions from lists but keeps a minimal owner-only acknowledgement', async () => {
    await insert(owner, 'deleted', 'deleted');
    expect(await repository.list(owner)).toEqual({ items: [], next: null });
    expect(await repository.findByClientId(owner, 'deleted')).toEqual({
      client_run_id: 'deleted',
      publication_status: 'deleted',
      public_run_id: null,
      url: null,
    });
    expect(await repository.findByClientId(stranger, 'deleted')).toBeUndefined();
  });

  it('paginates by server time with a stable sequence tie-breaker and no duplicates', async () => {
    await insert(owner, 'old', 'published', '2026-09-22T12:00:00Z');
    await insert(owner, 'tie_first', 'pending_review');
    await insert(owner, 'tie_second', 'rejected');
    await insert(stranger, 'foreign', 'published');
    const first = await repository.list(owner, { limit: 2 });
    expect(first.items.map(item => item.client_run_id)).toEqual(['tie_second', 'tie_first']);
    expect(first.next).not.toBeNull();
    const second = await repository.list(owner, { limit: 2, after: first.next! });
    expect(second.items.map(item => item.client_run_id)).toEqual(['old']);
    expect(second.next).toBeNull();
    expect((await repository.list(stranger, { limit: 2, after: first.next! })).items).toEqual([]);
  });

  it('bounds the default page and rejects invalid limits', async () => {
    for (let index = 0; index < 21; index++) {
      await insert(owner, `run_${index}`, 'pending_review');
    }

    expect((await repository.list(owner)).items).toHaveLength(20);
    expect((await repository.list(owner, { limit: 50 })).next).toBeNull();

    for (const limit of [0, -1, 51, 1.5, NaN]) {
      await expect(repository.list(owner, { limit })).rejects.toThrow(
        'Invalid submission page size',
      );
    }
  });

  it('fails closed for inconsistent publication visibility', async () => {
    await insert(owner, 'published', 'published');
    await db.prepare("UPDATE benchmark_runs SET visibility = 'hidden'").run();
    await expect(repository.list(owner)).rejects.toThrow('inconsistent');
  });
});
