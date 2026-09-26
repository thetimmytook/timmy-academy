import { readFile, readdir } from 'node:fs/promises';

import { ownerRunsResponseSchema, ownerRunLookupSchema } from '@timmy/contracts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationDenied } from '../auth/application-principal';
import { createClerkBrowserAdapter } from '../auth/clerk-browser-adapter';
import { TOKEN_LIFETIME_MS } from '../config';
import { createApp } from '../index';

import { D1SubmissionRepository } from './d1-submission-repository';
import { createSyntheticRuns } from './fixtures';
import { OwnerSubmissionReader } from './owner-submission-reader';

import type { SubmissionStatus } from './d1-submission-repository';
import type { ApplicationPrincipal } from '../auth/application-principal';
vi.mock('../auth/clerk-browser-adapter', () => ({ createClerkBrowserAdapter: vi.fn() }));
const authenticate = vi.fn<() => Promise<ApplicationPrincipal>>();
const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
];
const path = '/api/bench/v1/me/runs';
const secret = 'test-owner-cursor-secret';
const deleteSubmissions = 'DELETE FROM benchmark_submissions';
const cacheControl = 'Cache-Control';
const byClientId = '/by-client-id/';
const firstPage = '?limit=1';
const continuation = '?limit=1&cursor=';

async function request(
  suffix = '',
  cursorSecret: string | undefined = secret,
  method = 'GET',
): Promise<Response> {
  return createApp().request(
    path + suffix,
    { method },
    {
      BENCHMARK_DB: db,
      BENCHMARK_CURSOR_SECRET: cursorSecret,
      APP_ORIGIN: 'https://timmy.example',
      CLERK_ISSUER: 'https://browser.clerk.accounts.dev',
      CLERK_PUBLISHABLE_KEY: 'pk_test_fixture',
      CLERK_SECRET_KEY: 'sk_test_fixture',
      AUTH_RATE_LIMIT: { limit: vi.fn().mockResolvedValue({ success: true }) },
    },
  );
}

async function page(suffix = ''): Promise<ReturnType<typeof ownerRunsResponseSchema.parse>> {
  const response = await request(suffix);
  expect(response.status).toBe(200);
  expect(response.headers.get(cacheControl)).toBe('no-store');

  return ownerRunsResponseSchema.parse(await response.json());
}

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
  vi.mocked(createClerkBrowserAdapter).mockReturnValue({ authenticate });
  authenticate.mockReset().mockResolvedValue({
    accountId: owner,
    emailVerified: true,
    canModerate: false,
    session: { kind: 'browser', expiresAt: Date.now() + 60000 },
  });
  await db.batch([
    db.prepare(deleteSubmissions),
    db.prepare('DELETE FROM benchmark_runs'),
    db.prepare('DELETE FROM accounts'),
    db.prepare('INSERT INTO accounts(id) VALUES (?), (?)').bind(owner, stranger),
  ]);
});
afterAll(async () => {
  await mf?.dispose();
});

describe('protected owner submission HTTP API', () => {
  it('authenticates before validating list and lookup inputs', async () => {
    authenticate.mockRejectedValue(new AuthenticationDenied());

    for (const suffix of ['?limit=bad', '/by-client-id/invalid']) {
      const response = await request(suffix);
      expect(response.status).toBe(401);
      expect(response.headers.get(cacheControl)).toBe('no-store');
    }
  });
  it('isolates owners and sanitizes all private output', async () => {
    await insert(owner, ids[0]!, 'pending_review');
    await insert(stranger, ids[0]!, 'published');
    await insert(stranger, ids[1]!, 'published');
    await insert(owner, ids[2]!, 'rejected');
    const result = await page();
    expect(authenticate).toHaveBeenCalledOnce();
    expect(result.items.map(item => item.publication_status)).toEqual([
      'rejected',
      'pending_review',
    ]);
    expect(result.items.every(item => item.public_run_id === null && item.url === null)).toBe(true);
    expect(result.items[0]?.status_reason).toBe('rejected');

    for (const value of [
      owner,
      stranger,
      'fixture_reason',
      'private_contributor',
      'sequence',
      'issuer',
      'subject',
      'settings',
    ]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }

    const own = ownerRunLookupSchema.parse(await (await request(byClientId + ids[0])).json());
    expect(own.item.publication_status).toBe('pending_review');

    for (const id of [ids[1], ids[3]]) {
      expect((await request(byClientId + id)).status).toBe(404);
    }
  });
  it('returns deleted markers only through owner lookup', async () => {
    await insert(owner, ids[0]!, 'deleted');
    expect((await page()).items).toEqual([]);
    expect(
      ownerRunLookupSchema.parse(await (await request(byClientId + ids[0])).json()).item,
    ).toEqual({
      client_run_id: ids[0],
      publication_status: 'deleted',
      public_run_id: null,
      url: null,
    });
  });
  it.each([
    '?accountId=foreign',
    '?limit=0',
    '?limit=51',
    '?limit=1&limit=2',
    '?status=deleted',
    '?status=published%27%20OR%201=1--',
    '/by-client-id/invalid',
  ])('rejects invalid or unexpected input %s', async suffix => {
    expect((await request(suffix)).status).toBe(422);
  });
  it('filters statuses and exposes links only for published runs', async () => {
    await insert(owner, ids[0]!, 'published');
    await insert(owner, ids[1]!, 'pending_review');
    const result = await page('?status=published');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.public_run_id).not.toBeNull();
  });
  it('paginates without duplicates and allows later inserts below the cursor', async () => {
    await insert(owner, ids[0]!, 'published');
    await insert(owner, ids[1]!, 'pending_review');
    const first = await page(firstPage);
    expect(first.items[0]?.client_run_id).toBe(ids[1]);
    expect(first.next_cursor).toMatch(/^own_/);
    await insert(owner, ids[2]!, 'published', '2026-09-22T12:00:00Z');
    const second = await page(continuation + first.next_cursor);
    expect(second.items.map(item => item.client_run_id)).toEqual([ids[0]]);
    expect(second.next_cursor).not.toBeNull();
    const third = await page(continuation + second.next_cursor);
    expect(third.items.map(item => item.client_run_id)).toEqual([ids[2]]);
    expect(third.next_cursor).toBeNull();
  });
  it('binds cursors to owner, status, page size and signature', async () => {
    await insert(owner, ids[0]!, 'published');
    await insert(owner, ids[1]!, 'published');
    const { next_cursor: cursor } = await page(firstPage);

    for (const suffix of [
      '?limit=2&cursor=' + cursor,
      '?limit=1&status=published&cursor=' + cursor,
      continuation + cursor + 'x',
      '?limit=1&cursor=cur_invalid',
    ]) {
      expect((await request(suffix)).status).toBe(400);
    }

    authenticate.mockResolvedValue({
      accountId: stranger,
      emailVerified: true,
      canModerate: false,
      session: { kind: 'browser', expiresAt: Date.now() + 60000 },
    });
    expect((await request(continuation + cursor)).status).toBe(400);
  });
  it.each(['update', 'delete'] as const)(
    'invalidates a cursor on submission %s',
    async operation => {
      await insert(owner, ids[0]!, 'pending_review');
      await insert(owner, ids[1]!, 'pending_review');
      const { next_cursor: cursor } = await page(firstPage);

      if (operation === 'update') {
        await db
          .prepare(
            "UPDATE benchmark_submissions SET status = 'rejected', status_reason = 'private text'",
          )
          .run();
      } else {
        await db.prepare(deleteSubmissions).run();
      }

      const response = await request(continuation + cursor);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'cursor_stale' });
    },
  );
  it('expires cursors and detects mutation during a page read', async () => {
    await insert(owner, ids[0]!, 'pending_review');
    await insert(owner, ids[1]!, 'pending_review');
    const reader = new OwnerSubmissionReader(repository, secret);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);

    try {
      const first = await reader.list(owner, { status: 'all', limit: 1 });
      clock.mockReturnValue(1000 + TOKEN_LIFETIME_MS);
      await expect(
        reader.list(owner, { status: 'all', limit: 1, cursor: first.next_cursor! }),
      ).rejects.toMatchObject({ code: 'cursor_stale' });
    } finally {
      clock.mockRestore();
    }

    const originalList = repository.list.bind(repository);
    const spy = vi.spyOn(repository, 'list').mockImplementationOnce(async (...args) => {
      const result = await originalList(...args);
      await db.prepare(deleteSubmissions).run();

      return result;
    });

    try {
      await expect(reader.list(owner, { status: 'all', limit: 1 })).rejects.toMatchObject({
        code: 'cursor_stale',
      });
    } finally {
      spy.mockRestore();
    }
  });
  it('sanitizes configuration failures', async () => {
    const response = await request('', '');
    expect(response.status).toBe(500);
    expect(response.headers.get(cacheControl)).toBe('no-store');
    expect(await response.text()).not.toContain('signing');
  });
});
