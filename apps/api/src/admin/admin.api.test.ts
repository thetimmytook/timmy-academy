import { readFile, readdir } from 'node:fs/promises';

import { moderationQueueSchema } from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationDenied } from '../auth/application-principal';
import { createClerkBrowserAdapter } from '../auth/clerk-browser-adapter';
import { D1SubmissionApproval } from '../benchmark/d1-submission-approval';
import { D1SubmissionRejection } from '../benchmark/d1-submission-rejection';
import { createApp } from '../index';

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
  endpoint = path,
): Promise<Response> {
  return createApp().request(
    endpoint + suffix,
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
    canModerate: true,
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

const cacheControl = 'Cache-Control';
const queuePath = '/api/admin/v1/approvals';
const queue = (suffix = ''): Promise<Response> =>
  request('', contentType, suffix, 'GET', queuePath);
const decide = (id: number, decision: string, body = '', suffix = ''): Promise<Response> =>
  request(body, contentType, `/${id}/${decision}${suffix}`, 'POST', queuePath);

async function submit(client = dto.client_run_id): Promise<number> {
  expect((await request(JSON.stringify({ ...dto, client_run_id: client }))).status).toBe(202);

  return (await db
    .prepare('SELECT sequence FROM benchmark_submissions WHERE client_run_id = ?')
    .bind(client)
    .first<number>('sequence'))!;
}

describe('moderator approvals queue', () => {
  it.each(['approve', 'reject'])('applies %s and acknowledges exact repeats', async decision => {
    const id = await submit();
    const status = decision === 'approve' ? 'published' : 'rejected';

    for (const body of ['', '{}', 'not JSON', '{"decision":"other","submissionId":999}']) {
      const response = await decide(id, decision, body);
      expect(response.status).toBe(200);
      expect(response.headers.get(cacheControl)).toBe('no-store');
      expect(await response.json()).toEqual({ submission_id: id, publication_status: status });
    }

    expect(await db.prepare('SELECT status FROM benchmark_submissions').first('status')).toBe(
      status,
    );
    expect(await (await queue()).json()).toEqual({ items: [], next_after: null });
    const publicId = await db
      .prepare('SELECT public_id FROM benchmark_runs')
      .first<string>('public_id');
    const publicRead = await createApp().request(
      '/api/bench/v1/runs/' + publicId,
      {},
      { BENCHMARK_DB: db },
    );
    expect(publicRead.status).toBe(decision === 'approve' ? 200 : 404);
  });

  it('returns a conflict when moderators make opposite decisions', async () => {
    const id = await submit();
    const responses = await Promise.all([decide(id, 'approve'), decide(id, 'reject')]);
    expect(responses.map(response => response.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(await responses.find(response => response.status === 409)!.json()).toMatchObject({
      code: 'moderation_conflict',
    });
  });

  it.each(['approve', 'reject'])(
    'denies owner %s requests before validation or writes',
    async decision => {
      const id = await submit();
      authenticate.mockResolvedValue({
        accountId: owner,
        emailVerified: true,
        canModerate: false,
        session: { kind: 'browser', expiresAt: Date.now() + 60000 },
      });
      expect((await decide(id, decision)).status).toBe(403);
      expect((await decide(-1, decision, '{}')).status).toBe(403);
      expect(await db.prepare('SELECT status FROM benchmark_submissions').first('status')).toBe(
        'pending_review',
      );
      authenticate.mockRejectedValue(new AuthenticationDenied());
      expect((await decide(id, decision)).status).toBe(401);
    },
  );

  it.each([
    [-1, 'approve', '', ''],
    [1, 'unknown', '', ''],
    [1, 'reject', '', '?role=admin'],
  ] as const)('rejects invalid decision input %s %s %s %s', async (id, decision, body, suffix) => {
    expect((await decide(id, decision, body, suffix)).status).toBe(422);
  });

  it('returns not_found for a missing submission', async () => {
    expect((await decide(999, 'approve')).status).toBe(404);
    expect((await decide(999, 'reject')).status).toBe(404);
  });

  it('shows only pending measurements with an explicit projection', async () => {
    const id = await submit();
    const response = await queue();
    expect(response.status).toBe(200);
    expect(response.headers.get(cacheControl)).toBe('no-store');
    const body = moderationQueueSchema.parse(await response.json());
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0]!).sort((a, b) => a.localeCompare(b))).toEqual([
      'run',
      'submission_id',
      'submitted_at',
    ]);
    expect(body.items[0]!.submission_id).toBe(id);
    expect(body.items[0]!.run.metrics).toEqual(dto.metrics);
    expect(body.next_after).toBeNull();
    const serialized = JSON.stringify(body);

    for (const key of [
      'accountId',
      'account_id',
      'client_run_id',
      'public_run_id',
      'url',
      'request_fingerprint',
      'issuer',
      'subject',
    ]) {
      expect(body.items[0]!.run).not.toHaveProperty(key);
    }

    for (const value of [owner, dto.client_run_id, 'sk_test_fixture']) {
      expect(serialized).not.toContain(value);
    }

    await new D1SubmissionApproval(db).approve(id);
    expect(await (await queue()).json()).toEqual({ items: [], next_after: null });
  });

  it('paginates oldest first and excludes decisions made between pages', async () => {
    const ids = [
      await submit(),
      await submit('00000000-0000-4000-8000-000000000002'),
      await submit('00000000-0000-4000-8000-000000000003'),
    ];
    const first = moderationQueueSchema.parse(await (await queue('?limit=1')).json());
    expect(first.items.map(item => item.submission_id)).toEqual([ids[0]]);
    expect(first.next_after).toBe(ids[0]);
    await new D1SubmissionRejection(db).reject(ids[1]!);
    const next = moderationQueueSchema.parse(
      await (await queue('?limit=1&after=' + first.next_after)).json(),
    );
    expect(next.items.map(item => item.submission_id)).toEqual([ids[2]]);
    expect(next.next_after).toBeNull();
  });

  it('requires authentication before validating query input', async () => {
    authenticate.mockRejectedValue(new AuthenticationDenied());
    const response = await queue('?unknown=value');
    expect(response.status).toBe(401);
    expect(response.headers.get(cacheControl)).toBe('no-store');
  });

  it.each([
    { canModerate: false, kind: 'browser' as const },
    { canModerate: true, kind: 'desktop' as const },
  ])('denies access without browser moderator permission: %j', async ({ canModerate, kind }) => {
    authenticate.mockResolvedValue({
      accountId: owner,
      emailVerified: true,
      canModerate,
      session: { kind, expiresAt: Date.now() + 60000 },
    });
    const response = await queue('?unknown=value');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden' });
    expect(response.headers.get(cacheControl)).toBe('no-store');
  });

  it.each([
    '?limit=0',
    '?limit=51',
    '?after=-1',
    '?after=oops',
    '?limit=1&limit=2',
    '?owner=other',
  ])('rejects malformed or unexpected query: %s', async suffix => {
    expect((await queue(suffix)).status).toBe(422);
  });
});
