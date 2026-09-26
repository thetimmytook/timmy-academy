import { readFile, readdir } from 'node:fs/promises';

import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationDenied } from '../auth/application-principal';
import { createClerkBrowserAdapter } from '../auth/clerk-browser-adapter';
import { createApp } from '../index';

import { D1SubmissionApproval } from './d1-submission-approval';

import type { ApplicationPrincipal } from '../auth/application-principal';
vi.mock('../auth/clerk-browser-adapter', () => ({ createClerkBrowserAdapter: vi.fn() }));
const authenticate = vi.fn<() => Promise<ApplicationPrincipal>>();
let mf: Miniflare;
let db: D1Database;
const owner = 'acc_owner';
const stranger = 'acc_stranger';
const path = '/api/bench/v1/me/runs';
const contentType = 'application/json';
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
    {
      method,
      body: method === 'GET' ? null : body,
      headers: { 'Content-Type': type },
    },
    {
      BENCHMARK_DB: db,
      APP_ORIGIN: 'https://timmy.example',
      CLERK_ISSUER: 'https://browser.clerk.accounts.dev',
      CLERK_PUBLISHABLE_KEY: 'pk_test_fixture',
      CLERK_SECRET_KEY: 'sk_test_fixture',
      AUTH_RATE_LIMIT: { limit: vi.fn().mockResolvedValue({ success: true }) },
    },
  );
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

async function publish(): Promise<string> {
  expect((await request()).status).toBe(202);
  const sequence = await db
    .prepare('SELECT sequence FROM benchmark_submissions')
    .first<number>('sequence');

  return (await new D1SubmissionApproval(db).approve(sequence!))!.publicRunId;
}

function remove(id: string): Promise<Response> {
  return request('', contentType, '/' + id, 'DELETE');
}

describe('owner publication deletion API', () => {
  it('removes the public run, returns only the receipt, and accepts retries', async () => {
    const id = await publish();

    for (const body of ['', '{}', 'not JSON', '{"public_run_id":"br_other"}']) {
      const response = await request(body, contentType, '/' + id, 'DELETE');
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ publication_status: 'deleted', public_run_id: id });
    }

    expect(
      (await createApp().request('/api/bench/v1/runs/' + id, {}, { BENCHMARK_DB: db })).status,
    ).toBe(404);
    const replay = await request();
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ code: 'publication_deleted' });
  });

  it('rejects another owner without removing the publication', async () => {
    const id = await publish();
    authenticate.mockResolvedValue({
      accountId: stranger,
      emailVerified: true,
      canModerate: false,
      session: { kind: 'browser', expiresAt: Date.now() + 60000 },
    });
    const response = await remove(id);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'not_owner' });
    expect(
      (await createApp().request('/api/bench/v1/runs/' + id, {}, { BENCHMARK_DB: db })).status,
    ).toBe(200);
  });

  it('authenticates before validating deletion input', async () => {
    authenticate.mockRejectedValue(new AuthenticationDenied());
    const response = await remove('invalid?extra=private');
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each([
    ['invalid', ''],
    ['br_missing?extra=private', ''],
  ])('rejects invalid ID or query: %s %s', async (id, body) => {
    const response = await request(body, contentType, '/' + id, 'DELETE');
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'invalid_input' });
  });

  it('returns not_found for missing and unpublished runs', async () => {
    expect((await remove('br_missing')).status).toBe(404);
    await request();
    const id = await db.prepare('SELECT public_id FROM benchmark_runs').first<string>('public_id');
    expect((await remove(id!)).status).toBe(404);
    expect(await db.prepare('SELECT status FROM benchmark_submissions').first('status')).toBe(
      'pending_review',
    );
  });
});
