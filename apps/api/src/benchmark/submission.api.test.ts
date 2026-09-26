import { readFile, readdir } from 'node:fs/promises';

import {
  cohortResponseSchema,
  filterOptionsSchema,
  groupSearchResponseSchema,
} from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationDenied } from '../auth/application-principal';
import { createClerkBrowserAdapter } from '../auth/clerk-browser-adapter';
import { SUBMISSION_MAX_BODY_BYTES } from '../config';
import { createApp } from '../index';

import { D1SubmissionApproval } from './d1-submission-approval';
import { D1SubmissionDeletion } from './d1-submission-deletion';
import { D1SubmissionRejection } from './d1-submission-rejection';

import type { ApplicationPrincipal } from '../auth/application-principal';
import type { CohortResponse, GroupSearchResponse } from '@timmy/contracts';
vi.mock('../auth/clerk-browser-adapter', () => ({ createClerkBrowserAdapter: vi.fn() }));
const authenticate = vi.fn<() => Promise<ApplicationPrincipal>>();
let mf: Miniflare;
let db: D1Database;
const owner = 'acc_owner';
const stranger = 'acc_stranger';
const path = '/api/bench/v1/me/runs';
const contentType = 'application/json';
const noStore = 'no-store';
const cacheControl = 'Cache-Control';
const submissionSequenceQuery = 'SELECT sequence FROM benchmark_submissions';
const dto = {
  schema_version: 1,
  client_run_id: '00000000-0000-4000-8000-000000000001',
  captured_day: '2026-09-25',
  app_version: '1.0.0',
  hardware: { cpu_name: 'New CPU 123', gpu_name: 'New GPU 456', ram_gb: 32 },
  map: 'lighthouse',
  execution: 'bsg_servers',
  game_resolution: null,
  game_version: null,
  context: { weather: 'unknown', time_of_day: 'day' },
  settings_snapshot: null,
  capture: { duration_sec: 120, sample_count: 12000 },
  metrics: {
    average_fps: 100,
    one_percent_low_fps: 100,
    zero_point_one_percent_low_fps: 100,
    average_frametime_ms: 10,
    p95_frametime_ms: 10,
    p99_frametime_ms: 10,
  },
};

async function request(
  body = JSON.stringify(dto),
  type = contentType,
  suffix = '',
  method = 'POST',
): Promise<Response> {
  return createApp().request(
    path + suffix,
    { method, body: method === 'POST' ? body : null, headers: { 'Content-Type': type } },
    {
      BENCHMARK_DB: db,
      APP_ORIGIN: 'https://timmy.example',
      CLERK_ISSUER: 'https://browser.clerk.accounts.dev',
      CLERK_PUBLISHABLE_KEY: 'pk_test_fixture',
      CLERK_SECRET_KEY: 'sk_test_fixture',
    },
  );
}

async function counts(expected: number): Promise<void> {
  expect(await db.prepare('SELECT COUNT(*) AS count FROM benchmark_runs').first('count')).toBe(
    expected,
  );
  expect(
    await db.prepare('SELECT COUNT(*) AS count FROM benchmark_submissions').first('count'),
  ).toBe(expected);
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

beforeEach(async () => {
  vi.mocked(createClerkBrowserAdapter).mockReturnValue({ authenticate });
  authenticate.mockReset().mockResolvedValue({
    accountId: owner,
    emailVerified: true,
    canModerate: false,
    session: { kind: 'browser', expiresAt: Date.now() + 60000 },
  });
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

describe('protected submission upload', () => {
  it.each([
    ['lighthouse', 'Lighthouse'],
    ['customs', 'Customs'],
    ['streets', 'Streets of Tarkov'],
    ['woods', 'Woods'],
    ['factory', 'Factory'],
    ['the-lab', 'The Lab'],
    ['reserve', 'Reserve'],
    ['ground-zero', 'Ground Zero'],
    ['interchange', 'Interchange'],
    ['shoreline', 'Shoreline'],
    ['labyrinth', 'Labyrinth'],
  ])('supports %s from submission through public search and Position', async (id, name) => {
    const map = { id, name };
    const input = {
      ...dto,
      map: id,
      game_resolution: { width: 2560, height: 1440 },
      game_version: 'test-version',
    };
    const publicRequest = (suffix: string, init?: RequestInit): Promise<Response> =>
      Promise.resolve(
        createApp().request('/api/bench/v1' + suffix, init, {
          BENCHMARK_DB: db,
          BENCHMARK_CURSOR_SECRET: 'test-signing-secret',
        }),
      );

    const search = async (mapId = id): Promise<GroupSearchResponse> => {
      const response = await publicRequest('/runs?map=' + mapId);
      expect(response.status).toBe(200);

      return groupSearchResponseSchema.parse(await response.json());
    };

    const position = async (mapId = id): Promise<CohortResponse> => {
      const response = await publicRequest('/cohorts/query', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: JSON.stringify({
          hardware: input.hardware,
          map: mapId,
          execution: input.execution,
          game_resolution: input.game_resolution,
          game_version: input.game_version,
        }),
      });
      expect(response.status).toBe(200);

      return cohortResponseSchema.parse(await response.json());
    };

    expect((await position()).status).toBe('no_data');
    expect((await search()).summary.run_count).toBe(0);
    expect((await request(JSON.stringify(input))).status).toBe(202);
    expect((await position()).status).toBe('no_data');
    expect((await search()).summary.run_count).toBe(0);
    const pendingOptions = await publicRequest('/filter-options');
    expect(filterOptionsSchema.parse(await pendingOptions.json()).maps).toEqual([]);

    const sequence = await db.prepare(submissionSequenceQuery).first<number>('sequence');
    const approved = await new D1SubmissionApproval(db).approve(sequence!);
    expect(approved).toBeDefined();
    expect(await db.prepare('SELECT is_synthetic FROM benchmark_runs').first('is_synthetic')).toBe(
      0,
    );
    const found = await search();
    expect(found.summary.run_count).toBe(1);
    expect(found.groups[0]?.preview_runs[0]).toMatchObject({
      public_run_id: approved!.publicRunId,
      is_synthetic: false,
      map,
    });
    const cohort = await position();
    expect(cohort.status).toBe('matches');
    expect(cohort.runs.every(run => run.is_synthetic === false)).toBe(true);
    expect(cohort.criteria.map).toEqual(map);
    expect(cohort.runs.map(run => run.public_run_id)).toEqual([approved!.publicRunId]);
    const options = await publicRequest('/filter-options');
    expect(filterOptionsSchema.parse(await options.json()).maps).toEqual([map]);
    const otherMap = id === 'woods' ? 'factory' : 'woods';
    expect((await search(otherMap)).summary.run_count).toBe(0);
    expect((await position(otherMap)).status).toBe('no_data');
  });

  it('stores one hidden run and returns only a pending receipt', async () => {
    const response = await request();
    expect(response.status).toBe(202);
    expect(response.headers.get(cacheControl)).toBe(noStore);
    expect(await response.json()).toEqual({
      client_run_id: dto.client_run_id,
      publication_status: 'pending_review',
      public_run_id: null,
      url: null,
    });
    await counts(1);
    const run = await db
      .prepare('SELECT public_id, visibility, published_at, contributor_key FROM benchmark_runs')
      .first();
    expect(run).toMatchObject({ visibility: 'hidden', published_at: null, contributor_key: owner });
    const publicResponse = await createApp().request(
      '/api/bench/v1/runs/' + String(run?.public_id),
      {},
      { BENCHMARK_DB: db },
    );
    expect(publicResponse.status).toBe(404);
    const lookup = await request('', contentType, '/by-client-id/' + dto.client_run_id, 'GET');
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toMatchObject({
      item: {
        client_run_id: dto.client_run_id,
        publication_status: 'pending_review',
        public_run_id: null,
        url: null,
      },
    });
    const options = await createApp().request(
      '/api/bench/v1/filter-options',
      {},
      { BENCHMARK_DB: db },
    );
    expect(options.status).toBe(200);
    expect(await options.text()).not.toContain(dto.hardware.cpu_name);
  });
  it('ignores JSON key order on an exact retry and preserves the stored record', async () => {
    expect((await request()).status).toBe(202);
    const before = await db.prepare('SELECT * FROM benchmark_submissions').first();
    const reordered = {
      ...dto,
      hardware: { ram_gb: 32, gpu_name: dto.hardware.gpu_name, cpu_name: dto.hardware.cpu_name },
    };
    expect(
      (await request(JSON.stringify(Object.fromEntries(Object.entries(reordered).reverse()))))
        .status,
    ).toBe(202);
    expect(await db.prepare('SELECT * FROM benchmark_submissions').first()).toEqual(before);
    expect(before?.request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    await counts(1);
  });
  it.each([
    { ...dto, app_version: '1.0.1' },
    { ...dto, hardware: { ...dto.hardware, cpu_name: 'new cpu 123' } },
    { ...dto, captured_day: '2026-09-24' },
  ])('rejects changed validated content for the same client ID', async changed => {
    expect((await request()).status).toBe(202);
    const response = await request(JSON.stringify(changed));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'idempotency_conflict' });
    await counts(1);
  });
  it('serializes simultaneous exact retries without orphan runs', async () => {
    const responses = await Promise.all([request(), request(), request()]);
    expect(responses.map(response => response.status)).toEqual([202, 202, 202]);
    await counts(1);
  });
  it('allows only one winner for simultaneous conflicting requests', async () => {
    const responses = await Promise.all([
      request(),
      request(JSON.stringify({ ...dto, app_version: '2.0' })),
    ]);
    expect(responses.map(response => response.status).sort((a, b) => a - b)).toEqual([202, 409]);
    await counts(1);
  });
  it('scopes client IDs to the authenticated account', async () => {
    expect((await request()).status).toBe(202);
    authenticate.mockResolvedValue({
      accountId: stranger,
      emailVerified: true,
      canModerate: false,
      session: { kind: 'browser', expiresAt: Date.now() + 60000 },
    });
    expect((await request()).status).toBe(202);
    await counts(2);
  });
  it('authenticates before reading or validating the request', async () => {
    authenticate.mockRejectedValue(new AuthenticationDenied());
    expect((await request('invalid', 'text/plain')).status).toBe(401);
    await counts(0);
  });
  it.each([
    ['invalid', contentType, '', 422],
    [JSON.stringify(dto), 'text/plain', '', 415],
    [JSON.stringify(dto), contentType, '?accountId=other', 422],
    [JSON.stringify({ ...dto, accountId: stranger }), contentType, '', 422],
    [JSON.stringify({ ...dto, is_synthetic: true }), contentType, '', 422],
    [JSON.stringify({ ...dto, is_synthetic: false }), contentType, '', 422],
    [
      JSON.stringify({ ...dto, capture: { duration_sec: 120, sample_count: 1000 } }),
      contentType,
      '',
      422,
    ],
    [JSON.stringify({ ...dto, map: 'unknown-map' }), contentType, '', 422],
  ])('rejects invalid transport or payload without writes', async (body, type, suffix, status) => {
    expect((await request(body, type, suffix)).status).toBe(status);
    await counts(0);
  });
  it('enforces the 32 KiB body boundary', async () => {
    const body = JSON.stringify(dto);
    expect((await request(body.padEnd(SUBMISSION_MAX_BODY_BYTES + 1))).status).toBe(413);
    await counts(0);
    expect((await request(body.padEnd(SUBMISSION_MAX_BODY_BYTES))).status).toBe(202);
    await counts(1);
  });
});

it('returns 200 for an exact retry after approval and keeps changed requests conflicting', async () => {
  expect((await request()).status).toBe(202);
  const id = await db.prepare(submissionSequenceQuery).first<number>('sequence');
  const approved = await new D1SubmissionApproval(db).approve(id!);
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get(cacheControl)).toBe(noStore);
  expect(await response.json()).toEqual({
    client_run_id: dto.client_run_id,
    publication_status: 'published',
    public_run_id: approved!.publicRunId,
    url: '/bench/runs/' + approved!.publicRunId,
  });
  expect((await request(JSON.stringify({ ...dto, app_version: 'changed' }))).status).toBe(409);
  const published = await createApp().request(
    '/api/bench/v1/runs/' + approved!.publicRunId,
    {},
    { BENCHMARK_DB: db },
  );
  expect(published.status).toBe(200);
  expect(await published.text()).not.toContain(dto.client_run_id);
  await counts(1);
});

it('returns publication_deleted instead of recreating a deleted submission', async () => {
  expect((await request()).status).toBe(202);
  const id = (await db.prepare(submissionSequenceQuery).first<number>('sequence'))!;
  const approved = (await new D1SubmissionApproval(db).approve(id))!;
  await new D1SubmissionDeletion(db).delete(owner, approved.publicRunId);
  const replay = await request();
  expect(replay.status).toBe(409);
  expect(await replay.json()).toMatchObject({ code: 'publication_deleted' });
  expect(await db.prepare('SELECT count(*) AS count FROM benchmark_runs').first('count')).toBe(0);
});

it('returns a rejected receipt for an exact retry after moderation', async () => {
  expect((await request()).status).toBe(202);
  const id = (await db.prepare(submissionSequenceQuery).first<number>('sequence'))!;
  await new D1SubmissionRejection(db).reject(id);
  const replay = await request();
  expect(replay.status).toBe(200);
  expect(replay.headers.get(cacheControl)).toBe(noStore);
  expect(await replay.json()).toEqual({
    client_run_id: dto.client_run_id,
    publication_status: 'rejected',
    public_run_id: null,
    url: null,
    status_reason: 'rejected',
  });
  expect((await request(JSON.stringify({ ...dto, app_version: 'changed' }))).status).toBe(409);
  const lookup = await request('', contentType, '/by-client-id/' + dto.client_run_id, 'GET');
  expect(await lookup.json()).toMatchObject({
    item: {
      publication_status: 'rejected',
      status_reason: 'rejected',
      public_run_id: null,
      url: null,
    },
  });
  await counts(1);
});
