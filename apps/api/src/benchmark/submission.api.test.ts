import { readFile, readdir } from 'node:fs/promises';

import {
  cohortResponseSchema,
  filterOptionsSchema,
  groupSearchResponseSchema,
  publicRunDetailSchema,
  ownerRunLookupSchema,
  ownerRunsResponseSchema,
  moderationQueueSchema,
  MAX_LOGICAL_PROCESSORS,
  MAX_PAGEFILES,
} from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationDenied } from '../auth/application-principal';
import { createClerkBrowserAdapter } from '../auth/clerk-browser-adapter';
import {
  SUBMISSION_ACCOUNT_LIMIT,
  SUBMISSION_MAX_BODY_BYTES,
  SUBMISSION_QUOTA_WINDOW_MS,
} from '../config';
import { createApp } from '../index';

import { D1SubmissionApproval } from './d1-submission-approval';
import { D1SubmissionDeletion } from './d1-submission-deletion';
import { D1SubmissionRejection } from './d1-submission-rejection';
import { syntheticHardware } from './fixture-hardware';
import { createResourceTelemetryFixture } from './fixture-resource-telemetry';
import { projectResourceTelemetrySummary } from './resource-telemetry-projection';

import type { ApplicationPrincipal } from '../auth/application-principal';
import type { CohortResponse, GroupSearchResponse } from '@timmy/contracts';
vi.mock('../auth/clerk-browser-adapter', () => ({ createClerkBrowserAdapter: vi.fn() }));
const authenticate = vi.fn<() => Promise<ApplicationPrincipal>>();
let mf: Miniflare;
let db: D1Database;
const owner = 'acc_owner';
const stranger = 'acc_stranger';
const secondClientId = '00000000-0000-4000-8000-000000000002';
const path = '/api/bench/v1/me/runs';
const contentType = 'application/json';
const noStore = 'no-store';
const cacheControl = 'Cache-Control';
const submissionSequenceQuery = 'SELECT sequence FROM benchmark_submissions';
const publicRunPath = '/api/bench/v1/runs/';
const clientLookupPath = '/by-client-id/';
const storedDetailQuery = 'SELECT detail FROM benchmark_runs';
const storedSubmissionQuery = 'SELECT * FROM benchmark_submissions';
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
  resource_telemetry: createResourceTelemetryFixture(syntheticHardware[0]!),
  metrics: {
    average_fps: 100,
    one_percent_low_fps: 100,
    zero_point_one_percent_low_fps: 100,
    average_frametime_ms: 10,
    p95_frametime_ms: 10,
    p99_frametime_ms: 10,
  },
};

const changedTelemetry = structuredClone(dto.resource_telemetry);
Object.assign(changedTelemetry.cpu.total_utilization, {
  average: 55,
  minimum: 55,
  maximum: 55,
  last: 55,
});

async function request(
  body = JSON.stringify(dto),
  type = contentType,
  suffix = '',
  method = 'POST',
  endpoint = path,
): Promise<Response> {
  return createApp().request(
    endpoint + suffix,
    { method, body: method === 'POST' ? body : null, headers: { 'Content-Type': type } },
    {
      BENCHMARK_DB: db,
      BENCHMARK_CURSOR_SECRET: 'test-signing-secret',
      APP_ORIGIN: 'https://timmy.example',
      CLERK_ISSUER: 'https://browser.clerk.accounts.dev',
      CLERK_PUBLISHABLE_KEY: 'pk_test_fixture',
      CLERK_SECRET_KEY: 'sk_test_fixture',
      AUTH_RATE_LIMIT: { limit: vi.fn().mockResolvedValue({ success: true }) },
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

function quotaSubmission(index: number): string {
  return JSON.stringify({
    ...dto,
    client_run_id: `00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
    captured_day: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  });
}

async function fillQuota(count = SUBMISSION_ACCOUNT_LIMIT): Promise<void> {
  const responses = await Promise.all(
    Array.from({ length: count }, (_, index) => request(quotaSubmission(index))),
  );
  expect(responses.map(response => response.status)).toEqual(Array<number>(count).fill(202));
}

afterEach(() => vi.restoreAllMocks());

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
  it('limits new submissions while preserving retries, conflicts and independent account quotas', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 26, 12));
    await fillQuota();
    const blocked = await request();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('86400');
    expect(blocked.headers.get(cacheControl)).toBe(noStore);
    expect(await blocked.json()).toMatchObject({
      code: 'rate_limited',
      retry_after_seconds: 86400,
    });
    expect((await request(quotaSubmission(0))).status).toBe(202);
    const conflict = await request(quotaSubmission(0).replace('lighthouse', 'woods'));
    expect(await conflict.json()).toMatchObject({ code: 'idempotency_conflict' });
    const duplicate = await request(quotaSubmission(0).replace('000000000100', '000000000999'));
    expect(await duplicate.json()).toMatchObject({ code: 'duplicate_run' });
    await counts(SUBMISSION_ACCOUNT_LIMIT);
    authenticate.mockResolvedValue({
      accountId: stranger,
      emailVerified: true,
      canModerate: false,
      session: { kind: 'browser', expiresAt: Date.now() + 60000 },
    });
    expect((await request()).status).toBe(202);
    await counts(SUBMISSION_ACCOUNT_LIMIT + 1);
  }, 30000);
  it('accepts only one concurrent submission into the last quota slot without orphan runs', async () => {
    await fillQuota(SUBMISSION_ACCOUNT_LIMIT - 1);
    const responses = await Promise.all([49, 50, 51].map(index => request(quotaSubmission(index))));
    expect(responses.map(response => response.status).sort((a, b) => a - b)).toEqual([
      202, 429, 429,
    ]);
    await counts(SUBMISSION_ACCOUNT_LIMIT);
  }, 30000);
  it('opens a slot exactly when a submission leaves the rolling 24-hour window', async () => {
    const now = Date.UTC(2026, 8, 26, 12);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await fillQuota();
    clock.mockReturnValue(now + SUBMISSION_QUOTA_WINDOW_MS - 1);
    const blocked = await request();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ retry_after_seconds: 1 });
    clock.mockReturnValue(now + SUBMISSION_QUOTA_WINDOW_MS);
    expect((await request()).status).toBe(202);
    await counts(SUBMISSION_ACCOUNT_LIMIT + 1);
  }, 30000);
  it('does not restore submission quota when a published run is deleted', async () => {
    await fillQuota();
    const sequence = await db.prepare(submissionSequenceQuery).first<number>('sequence');
    const published = await new D1SubmissionApproval(db).approve(sequence!);
    await new D1SubmissionDeletion(db).delete(owner, published!.publicRunId);
    expect((await request()).status).toBe(429);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM benchmark_runs').first('count')).toBe(
      SUBMISSION_ACCOUNT_LIMIT - 1,
    );
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM benchmark_submissions').first('count'),
    ).toBe(SUBMISSION_ACCOUNT_LIMIT);
  }, 30000);
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
    expect(cohort.runs.every(run => !Object.hasOwn(run, 'resource_telemetry'))).toBe(true);
    expect(found.groups[0]?.preview_runs[0]).not.toHaveProperty('resource_telemetry');
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
      publicRunPath + String(run?.public_id),
      {},
      { BENCHMARK_DB: db },
    );
    expect(publicResponse.status).toBe(404);
    const lookup = await request('', contentType, clientLookupPath + dto.client_run_id, 'GET');
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
    const before = await db.prepare(storedSubmissionQuery).first();
    const reordered = {
      ...dto,
      hardware: { ram_gb: 32, gpu_name: dto.hardware.gpu_name, cpu_name: dto.hardware.cpu_name },
    };
    expect(
      (await request(JSON.stringify(Object.fromEntries(Object.entries(reordered).reverse()))))
        .status,
    ).toBe(202);
    expect(await db.prepare(storedSubmissionQuery).first()).toEqual(before);
    expect(before?.request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    await counts(1);
  });
  it.each([
    { ...dto, app_version: '1.0.1' },
    { ...dto, resource_telemetry: changedTelemetry },
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
  it.each(['nvapi_gpu_graphics_utilization', 'adlx_gpu_usage'] as const)(
    'fingerprints a change to %s without changing FPS duplicate detection',
    async source => {
      expect((await request()).status).toBe(202);
      const before = await db.prepare(storedDetailQuery).first('detail');
      const resource_telemetry = structuredClone(dto.resource_telemetry);
      resource_telemetry.gpu.graphics_utilization.source = source;
      const input = { ...dto, resource_telemetry };
      const conflict = await request(JSON.stringify(input));
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ code: 'idempotency_conflict' });
      const duplicate = await request(JSON.stringify({ ...input, client_run_id: secondClientId }));
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toMatchObject({ code: 'duplicate_run' });
      expect(await db.prepare(storedDetailQuery).first('detail')).toBe(before);
      await counts(1);
    },
  );
  it.each(['pending_review', 'published', 'rejected'])(
    'rejects a new client ID for the same %s measurement',
    async status => {
      expect((await request()).status).toBe(202);
      const sequence = await db.prepare(submissionSequenceQuery).first<number>('sequence');

      if (status === 'published') {
        await new D1SubmissionApproval(db).approve(sequence!);
      } else if (status === 'rejected') {
        await new D1SubmissionRejection(db).reject(sequence!);
      }

      const response = await request(
        JSON.stringify({
          ...dto,
          client_run_id: secondClientId,
          app_version: '2.0',
          hardware: { ...dto.hardware, cpu_name: ' NEW  CPU 123 ' },
          resource_telemetry: changedTelemetry,
        }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'duplicate_run' });
      await counts(1);
    },
  );
  it('serializes duplicate measurements with different client IDs without orphan runs', async () => {
    const responses = await Promise.all(
      [1, 2, 3].map(index =>
        request(
          JSON.stringify({
            ...dto,
            client_run_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          }),
        ),
      ),
    );
    expect(responses.map(response => response.status).sort((a, b) => a - b)).toEqual([
      202, 409, 409,
    ]);

    for (const response of responses.filter(response => response.status === 409)) {
      expect(await response.json()).toMatchObject({ code: 'duplicate_run' });
    }

    await counts(1);
  });
  it('accepts a distinct measurement with a new client ID', async () => {
    expect((await request()).status).toBe(202);
    expect(
      (
        await request(
          JSON.stringify({
            ...dto,
            client_run_id: secondClientId,
            map: 'woods',
          }),
        )
      ).status,
    ).toBe(202);
    await counts(2);
  });
  it('detects duplicates of older stored measurements without synthetic metadata', async () => {
    expect((await request()).status).toBe(202);
    await db
      .prepare("UPDATE benchmark_runs SET detail = json_remove(detail, '$.is_synthetic')")
      .run();
    const response = await request(
      JSON.stringify({
        ...dto,
        client_run_id: secondClientId,
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'duplicate_run' });
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
  it.each([
    'pdh_gpu_engine_3d_busiest_engine',
    'nvapi_gpu_graphics_utilization',
    'adlx_gpu_usage',
  ] as const)('accepts %s with 512 logical processors and 32 anonymous pagefiles', async source => {
    const resource_telemetry = structuredClone(dto.resource_telemetry);
    resource_telemetry.gpu.graphics_utilization.source = source;
    const processor = resource_telemetry.cpu.logical_processors[0]!;
    const gib = 2 ** 30;
    Object.assign(processor.utilization, {
      average: 53.12345678901234,
      minimum: 53.12345678901234,
      maximum: 53.12345678901234,
      last: 53.12345678901234,
    });
    resource_telemetry.cpu.logical_processors = Array.from(
      { length: MAX_LOGICAL_PROCESSORS },
      (_, index) => ({
        ...processor,
        group: Math.floor(index / 64),
        index: index % 64,
      }),
    );
    const file = resource_telemetry.pagefile.files[0]!;

    const setValue = (metric: typeof file.used, value: number): void => {
      Object.assign(metric, { average: value, minimum: value, maximum: value, last: value });
    };

    setValue(file.allocated, gib);
    setValue(file.used, gib / 8);
    resource_telemetry.pagefile.files = Array.from({ length: MAX_PAGEFILES }, (_, index) => ({
      ...file,
      index: index + 1,
    }));
    setValue(resource_telemetry.pagefile.file_count, MAX_PAGEFILES);
    setValue(resource_telemetry.pagefile.allocated, MAX_PAGEFILES * gib);
    setValue(resource_telemetry.pagefile.used, 4 * gib);
    setValue(resource_telemetry.commit.used, 16 * gib);
    setValue(resource_telemetry.commit.limit, 62 * gib);
    setValue(resource_telemetry.commit.headroom, 46 * gib);

    const body = JSON.stringify({ ...dto, resource_telemetry });
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(32 * 1024);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(SUBMISSION_MAX_BODY_BYTES);
    expect((await request(body)).status).toBe(202);
    await counts(1);
  });
  it.each(['unknown_gpu_utilization', 'nvapi_gpu_graphics_utilization', 'adlx_gpu_usage'])(
    'rejects unknown sources or private nested additions in %s before writing',
    async source => {
      const telemetry = structuredClone(dto.resource_telemetry);
      Object.assign(telemetry.gpu.graphics_utilization, { source });

      if (source !== 'unknown_gpu_utilization') {
        Object.assign(telemetry.gpu.graphics_utilization, {
          raw_samples: [85],
          device_id: 'private',
        });
      }

      const response = await request(JSON.stringify({ ...dto, resource_telemetry: telemetry }));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'invalid_input' });
      await counts(0);
    },
  );
  it('rejects missing telemetry, an oversized capture window and private nested fields before writing', async () => {
    const { resource_telemetry, ...missing } = dto;
    const privateField = {
      ...resource_telemetry,
      pagefile: {
        ...resource_telemetry.pagefile,
        files: resource_telemetry.pagefile.files.map(file => ({
          ...file,
          drive_letter: 'C',
          path: 'private-path',
        })),
      },
    };

    for (const input of [
      missing,
      { ...dto, resource_telemetry: null },
      { ...dto, resource_telemetry: privateField },
      {
        ...dto,
        resource_telemetry: createResourceTelemetryFixture(syntheticHardware[0]!, 121),
      },
    ]) {
      const response = await request(JSON.stringify(input));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'invalid_input' });
    }

    await counts(0);
  });
  it.each(
    (
      [
        'pdh_gpu_engine_3d_busiest_engine',
        'nvapi_gpu_graphics_utilization',
        'adlx_gpu_usage',
      ] as const
    ).flatMap(source =>
      ['available', 'partial', 'unavailable'].map(status => ({ source, status })),
    ),
  )(
    'preserves $source ($status) through retries, moderation, owner API and public detail',
    async ({ source, status }) => {
      const telemetry = structuredClone(dto.resource_telemetry);
      const metric = telemetry.gpu.graphics_utilization;
      metric.source = source;

      if (status === 'partial') {
        Object.assign(metric, {
          status,
          coverage: 0.75,
          valid_duration_sec: 90,
          valid_sample_count: 90,
          reason_codes: ['partial_coverage'],
        });
        telemetry.status = 'partial';
        telemetry.warnings = ['partial_coverage'];
      } else if (status === 'unavailable') {
        Object.assign(metric, {
          status,
          average: null,
          minimum: null,
          maximum: null,
          last: null,
          coverage: 0,
          valid_duration_sec: 0,
          valid_sample_count: 0,
          reason_codes: ['counter_unavailable'],
        });
        telemetry.status = 'partial';
        telemetry.warnings = ['counter_unavailable'];
      }

      const body = JSON.stringify({ ...dto, resource_telemetry: telemetry });
      expect((await request(body)).status).toBe(202);
      const storedBefore = await db.prepare(storedDetailQuery).first<string>('detail');
      expect(publicRunDetailSchema.parse(JSON.parse(storedBefore!)).resource_telemetry).toEqual(
        telemetry,
      );
      const submissionBefore = await db.prepare(storedSubmissionQuery).first();
      expect((await request(body)).status).toBe(202);
      expect(await db.prepare(storedSubmissionQuery).first()).toEqual(submissionBefore);
      authenticate.mockResolvedValue({
        accountId: owner,
        emailVerified: true,
        canModerate: true,
        session: { kind: 'browser', expiresAt: Date.now() + 60000 },
      });
      const queue = await request('', contentType, '', 'GET', '/api/admin/v1/approvals');
      expect(queue.status).toBe(200);
      const pending = moderationQueueSchema.parse(await queue.json());
      expect(pending.items[0]!.run.resource_telemetry).toEqual(telemetry);
      const lookup = await request('', contentType, clientLookupPath + dto.client_run_id, 'GET');
      const item = ownerRunLookupSchema.parse(await lookup.json()).item;
      expect(item).toMatchObject({
        resource_telemetry: projectResourceTelemetrySummary(telemetry),
      });
      expect(item).not.toHaveProperty('resource_telemetry.cpu.logical_processors');
      expect(item).not.toHaveProperty('resource_telemetry.pagefile.files');
      const ownerList = await request('', contentType, '', 'GET');
      expect(ownerList.status).toBe(200);
      const list = ownerRunsResponseSchema.parse(await ownerList.json());
      expect(list.items[0]!.resource_telemetry).toEqual(projectResourceTelemetrySummary(telemetry));
      expect(
        (
          await request(
            '',
            contentType,
            `/${pending.items[0]!.submission_id}/approve`,
            'POST',
            '/api/admin/v1/approvals',
          )
        ).status,
      ).toBe(200);
      const published = ownerRunLookupSchema.parse(
        await (await request('', contentType, clientLookupPath + dto.client_run_id, 'GET')).json(),
      ).item;
      expect(published).toMatchObject({
        publication_status: 'published',
        resource_telemetry: projectResourceTelemetrySummary(telemetry),
      });
      const publicResponse = await createApp().request(
        publicRunPath + published.public_run_id,
        {},
        { BENCHMARK_DB: db },
      );
      expect(publicResponse.status).toBe(200);
      expect(publicRunDetailSchema.parse(await publicResponse.json()).resource_telemetry).toEqual(
        telemetry,
      );
      expect(await db.prepare(storedDetailQuery).first('detail')).toBe(storedBefore);
    },
  );
  it('enforces the 256 KiB body boundary', async () => {
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
    publicRunPath + approved!.publicRunId,
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
  const lookup = await request('', contentType, clientLookupPath + dto.client_run_id, 'GET');
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
