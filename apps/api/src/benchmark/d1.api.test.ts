import { readFile, readdir } from 'node:fs/promises';

import {
  cohortResponseSchema,
  filterOptionsSchema,
  groupRunsResponseSchema,
  groupSearchResponseSchema,
  publicRunDetailSchema,
  runSearchQuerySchema,
} from '@timmy/contracts';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOKEN_LIFETIME_MS } from '../config';
import { runs } from '../db/schema';
import { createApp } from '../index';

import { predicate } from './d1-query';
import { D1BenchmarkRepository } from './d1-repository';
import { syntheticHardware } from './fixtures';
import { normalizeHardware } from './hardware-normalization';
import { InMemoryBenchmarkRepository } from './in-memory-repository';
import { seedRows, seedStatements } from './seed';

import type { StoredRun } from './stored-run';
import type { GroupSearchResponse, GroupRunsResponse, CohortResponse } from '@timmy/contracts';
import type { Hono } from 'hono';

const fixtureCpuId = syntheticHardware[0]!.cpu.id;
const fixtureGpuId = syntheticHardware[0]!.gpu.id;
const otherCpuId = syntheticHardware[2]!.cpu.id;
const otherGpuId = syntheticHardware[2]!.gpu.id;
const signingSecret = 'test-signing-secret';
const base = '/api/bench/v1';
const firstSeedRunPath = '/runs/br_test_01';
const filterOptionsPath = '/filter-options';
let mf: Miniflare;
let db: D1Database;
let now = 1000000;
const app = (): Hono => createApp(new D1BenchmarkRepository(db, signingSecret));
const request = (path: string): Response | Promise<Response> => app().request(base + path);

const groups = async (query = ''): Promise<GroupSearchResponse> => {
  const response = await request('/runs' + (query ? '?' + query : ''));
  expect(response.status).toBe(200);

  return groupSearchResponseSchema.parse(await response.json());
};

const items = async (key: string, suffix = ''): Promise<GroupRunsResponse> => {
  const response = await request(`/runs?view=items&group_key=${key}${suffix}`);
  expect(response.status).toBe(200);

  return groupRunsResponseSchema.parse(await response.json());
};

const seed = (): Promise<D1Result<unknown>[]> =>
  db.batch(seedStatements().map(statement => db.prepare(statement)));
const exact = {
  hardware: { cpu_name: 'Ryzen 7 7800X3D', gpu_name: 'GeForce RTX 4070 SUPER', ram_gb: 32 },
  map: 'lighthouse',
  execution: 'bsg_servers',
  game_resolution: { width: 2560, height: 1440 },
  game_version: '0.16.9.0',
};

const position = async (body: unknown = exact): Promise<CohortResponse> => {
  const response = await app().request(`${base}/cohorts/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);

  return cohortResponseSchema.parse(await response.json());
};

async function insert(run: StoredRun, id: string): Promise<void> {
  const detail = { ...run.detail, public_run_id: id, url: `/bench/runs/${id}` };
  await db
    .prepare(
      'INSERT INTO benchmark_runs(public_id, contributor_key, published_at, detail) VALUES (?, ?, ?, ?)',
    )
    .bind(id, run.contributor, run.publishedAt, JSON.stringify(detail))
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
  const folder = new URL('../../../../infrastructure/migrations/', import.meta.url);

  // The directory is fixed inside this repository; its SQL files are test inputs.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migrationNames = (await readdir(folder))
    .filter(name => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const name of migrationNames) {
    // Names come from the fixed directory listing above.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const sql = await readFile(new URL(name, folder), 'utf8');
    await db.batch(
      sql
        .split('--> statement-breakpoint')
        .map(statement => db.prepare(statement.trim()))
        .filter(statement => statement),
    );
  }
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  now = 1000000;
  await db.batch([db.prepare('DELETE FROM benchmark_runs')]);
  await seed();
});

describe('real local D1 public HTTP integration', { timeout: 30000 }, () => {
  it('resumes the client snapshot after reload and new publications without a token table', async () => {
    const first = await groups('limit=1');
    const key = first.groups[0]!.group_key;
    now += 1000;
    await insert(seedRows()[0]!, 'br_after_snapshot');
    const resumed = await groups(`limit=1&snapshot=${key}`);
    expect(resumed).toEqual(first);
    expect((await groups('limit=1')).summary.run_count).toBe(25);
    expect((await request(`/runs?map=woods&snapshot=${key}`)).status).toBe(409);
    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'benchmark_tokens'")
      .all();
    expect(tables.results).toEqual([]);
  });

  it('rejects a tampered client cursor and cannot issue one without the signing secret', async () => {
    const first = await groups('limit=1');
    const cursor = first.next_cursor!;
    const forged = cursor.slice(0, 20) + (cursor[20] === 'A' ? 'B' : 'A') + cursor.slice(21);
    expect((await request(`/runs?limit=1&cursor=${forged}`)).status).toBe(400);
    const response = await createApp().request(`${base}/runs`, {}, { BENCHMARK_DB: db });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(signingSecret);
  });

  it('matches fixture search semantics, filters, ordering, counts and previews', async () => {
    const memory = new InMemoryBenchmarkRepository(
      seedRows().filter(row => row.visibility === 'published'),
    );

    for (const raw of [
      {},
      { sort: 'captured_asc' },
      { cpu: fixtureCpuId },
      { gpu: otherGpuId, ram_gb: '16' },
      { map: 'woods' },
      { execution: 'local' },
      { game_width: '1920', game_height: '1080' },
      { game_version: '0.16.9.0' },
      { map: 'woods', game_version: '0.16.9.0', execution: 'local' },
    ]) {
      const query = runSearchQuerySchema.parse(raw);
      const expected = groupSearchResponseSchema.parse(await memory.search(query));
      const actual = await groups(new URLSearchParams(raw).toString());
      const scrub = (value: typeof actual): GroupSearchResponse => ({
        ...value,
        groups: value.groups.map(group => ({ ...group, group_key: 'opaque' })),
      });
      expect(scrub(actual)).toEqual(scrub(expected));
    }

    const result = await groups();
    expect(result.summary).toEqual({ group_count: 3, run_count: 24, contributor_count: 6 });
    expect(
      result.groups.every(
        group =>
          group.map_count === 4 &&
          group.preview_runs.length === 3 &&
          group.remaining_run_count === 5,
      ),
    ).toBe(true);
  });
  it('paginates groups and items in both directions with no duplicates', async () => {
    for (const sort of ['captured_asc', 'captured_desc']) {
      const first = await groups(`limit=1&sort=${sort}`);
      const second = await groups(`limit=1&sort=${sort}&cursor=${first.next_cursor}`);
      const third = await groups(`limit=1&sort=${sort}&cursor=${second.next_cursor}`);
      expect(third.next_cursor).toBeNull();
      expect(
        new Set([first, second, third].map(page => JSON.stringify(page.groups[0]?.hardware))).size,
      ).toBe(3);
      const key = first.groups[0]!.group_key;
      expect((await groups('limit=1&sort=' + sort)).groups[0]!.group_key).toBe(key);
      const ids: string[] = [];
      let cursor: string | null = null;

      do {
        const page = await items(
          key,
          `&limit=2&sort=${sort}` + (cursor ? '&cursor=' + cursor : ''),
        );
        ids.push(...page.items.map(run => run.public_run_id));
        cursor = page.next_cursor;
      } while (cursor);

      expect(ids).toHaveLength(8);
      expect(new Set(ids).size).toBe(8);
    }
  });
  it('keeps snapshots across publications and repository instances; binds every cursor field', async () => {
    const first = await groups('limit=1');
    const key = first.groups[0]!.group_key;
    expect((await groups('limit=1')).groups[0]!.group_key).toBe(key);
    const firstItems = await items(key, '&limit=2');
    const before = await groups(`limit=1&cursor=${first.next_cursor}`);
    await insert(seedRows()[0]!, 'br_test_new');
    const after = await groups(`limit=1&cursor=${first.next_cursor}`);
    expect(after.summary).toEqual(before.summary);
    expect(after.groups.map(group => group.hardware)).toEqual(
      before.groups.map(group => group.hardware),
    );
    expect((await items(key)).items.some(run => run.public_run_id === 'br_test_new')).toBe(false);
    expect((await groups()).summary.run_count).toBe(25);

    for (const suffix of [
      'limit=2',
      'limit=1&sort=captured_asc',
      'limit=1&map=woods',
      'view=items&group_key=' + key,
    ]) {
      const response = await request(`/runs?${suffix}&cursor=${first.next_cursor}`);
      expect(response.status).toBe(400);
    }

    expect(
      (await request(`/runs?view=items&group_key=${key}&limit=3&cursor=${firstItems.next_cursor}`))
        .status,
    ).toBe(400);
    expect((await request(`/runs?view=items&group_key=${key}&map=woods`)).status).toBe(409);
    expect((await request('/runs?cursor=cur_forged')).status).toBe(400);
  });
  it.each(['hidden', 'deleted', 'physical-delete'])(
    'invalidates navigation and excludes %s records from every public read',
    async visibility => {
      const first = await groups('limit=1');
      const key = first.groups[0]!.group_key;
      expect((await groups('limit=1')).groups[0]!.group_key).toBe(key);
      const page = await items(key, '&limit=1');

      if (visibility === 'physical-delete') {
        await db.prepare("DELETE FROM benchmark_runs WHERE public_id = 'br_test_01'").run();
      } else {
        await db
          .prepare("UPDATE benchmark_runs SET visibility = ? WHERE public_id = 'br_test_01'")
          .bind(visibility)
          .run();
      }

      for (const path of [
        `/runs?limit=1&cursor=${first.next_cursor}`,
        `/runs?view=items&group_key=${key}`,
        `/runs?view=items&group_key=${key}&limit=1&cursor=${page.next_cursor}`,
      ]) {
        expect((await request(path)).status).toBe(409);
      }

      expect((await request(firstSeedRunPath)).status).toBe(404);
      expect((await groups()).summary.run_count).toBe(23);
      expect((await position()).runs.map(run => run.public_run_id)).toEqual(['br_test_05']);
      await db
        .prepare(`UPDATE benchmark_runs SET visibility = 'hidden' WHERE cpu = '${otherCpuId}'`)
        .run();
      const options = filterOptionsSchema.parse(await (await request(filterOptionsPath)).json());
      expect(options.cpus.map(cpu => cpu.id)).not.toContain(otherCpuId);
      expect(options.ram_gb).toEqual([32, 64]);
    },
  );
  it('expires cursors and groups exactly at 30 minutes, including after token cleanup', async () => {
    const first = await groups('limit=1');
    now += TOKEN_LIFETIME_MS - 1;
    await groups(`limit=1&cursor=${first.next_cursor}`);
    now++;
    expect((await request(`/runs?limit=1&cursor=${first.next_cursor}`)).status).toBe(409);
    expect((await request(`/runs?view=items&group_key=${first.groups[0]!.group_key}`)).status).toBe(
      409,
    );
    await groups();
    expect((await request(`/runs?limit=1&cursor=${first.next_cursor}`)).status).toBe(409);
  });
  it('implements exact Position, no_data, missing conditions and null detail values', async () => {
    const result = await position();
    expect(result.status).toBe('matches');
    expect(result.counts).toEqual({ run_count: 2, contributor_count: 1 });
    expect(result.runs.map(run => run.public_run_id)).toEqual(['br_test_01', 'br_test_05']);
    expect((await position({ ...exact, game_version: 'no-match' })).status).toBe('no_data');
    expect(
      (await position({ ...exact, game_resolution: null, game_version: null })).reason_codes,
    ).toEqual(['unknown_game_resolution', 'game_version_missing']);
    const unknown = publicRunDetailSchema.parse(await (await request('/runs/br_test_08')).json());
    expect(unknown.conditions.game_resolution).toBeNull();
    expect(unknown.settings).toBeNull();
    expect(
      publicRunDetailSchema.parse(await (await request('/runs/br_test_07')).json()).conditions
        .game_version,
    ).toBeNull();

    for (const id of ['br_test_hidden', 'br_test_deleted']) {
      expect((await request(`/runs/${id}`)).status).toBe(404);
    }
  });
  it('compares unfamiliar hardware using the same IDs as submission normalization', async () => {
    const input = { cpu_name: 'New CPU 123', gpu_name: 'New GPU 456 Laptop', ram_gb: 32 };
    expect((await position({ ...exact, hardware: input })).status).toBe('no_data');
    const source = seedRows()[0]!;
    await insert(
      { ...source, detail: { ...source.detail, hardware: await normalizeHardware(input) } },
      'br_new_hardware',
    );
    const result = await position({
      ...exact,
      hardware: { ...input, cpu_name: ' NEW  cpu 123 ', gpu_name: 'new gpu 456 LAPTOP' },
    });
    expect(result.status).toBe('matches');
    expect(result.runs.map(run => run.public_run_id)).toEqual(['br_new_hardware']);
    expect(
      (await position({ ...exact, hardware: { ...input, gpu_name: 'New GPU 456' } })).status,
    ).toBe('no_data');
  });
  it('bounds Position examples without averaging and counts distinct contributors', async () => {
    for (let index = 0; index < 22; index++) {
      await insert(seedRows()[0]!, `br_test_extra_${index}`);
    }

    const result = await position();
    expect(result.counts).toEqual({ run_count: 24, contributor_count: 1 });
    expect(result.runs).toHaveLength(20);
    expect(result.truncated).toBe(true);
  });
  it('seed is idempotent, preserves unrelated data and never republishes hidden fixtures', async () => {
    await insert(seedRows()[0]!, 'br_unrelated');
    await db
      .prepare("UPDATE benchmark_runs SET visibility = 'hidden' WHERE public_id = 'br_test_01'")
      .run();
    const first = await groups('limit=1');
    await seed();
    await seed();
    expect((await groups()).summary.run_count).toBe(24);
    expect((await request('/runs/br_unrelated')).status).toBe(200);
    expect((await request(firstSeedRunPath)).status).toBe(404);
    await groups(`limit=1&cursor=${first.next_cursor}`);
  });
  it('uses each row synthetic flag in mixed previews, items, details and Position', async () => {
    const source = seedRows()[0]!;
    await insert(
      { ...source, detail: { ...source.detail, captured_day: '2026-09-26' } },
      'br_real',
    );

    // The inserted document says synthetic, but the database default is real.
    const result = await groups('ram_gb=32');
    const previews = result.groups[0]!.preview_runs;
    expect(previews.find(run => run.public_run_id === 'br_real')?.is_synthetic).toBe(false);
    expect(previews.some(run => run.is_synthetic)).toBe(true);
    const page = await items(result.groups[0]!.group_key, '&ram_gb=32');
    expect(page.items.find(run => run.public_run_id === 'br_real')?.is_synthetic).toBe(false);
    expect(
      page.items.filter(run => run.public_run_id !== 'br_real').every(run => run.is_synthetic),
    ).toBe(true);
    expect(await (await request('/runs/br_real')).json()).toMatchObject({ is_synthetic: false });
    expect(await (await request(firstSeedRunPath)).json()).toMatchObject({ is_synthetic: true });
    const cohort = await position();
    expect(cohort.runs.find(run => run.public_run_id === 'br_real')?.is_synthetic).toBe(false);
    expect(cohort.runs.some(run => run.is_synthetic)).toBe(true);
  });
  it('uses explicit projections even when stored documents contain future private fields', async () => {
    await db
      .prepare(
        `UPDATE benchmark_runs SET detail = json_set(detail,
      '$.account_id', 'PRIVATE_SENTINEL', '$.conditions.raw_capture', 'PRIVATE_SENTINEL',
      '$.settings.graphics.machine_id', 'PRIVATE_SENTINEL', '$.hardware.cpu.private_id', 'PRIVATE_SENTINEL')`,
      )
      .run();

    for (const response of [
      await groups(),
      await position(),
      await (await request(firstSeedRunPath)).json(),
      await (await request(filterOptionsPath)).json(),
    ]) {
      const json = JSON.stringify(response);
      expect(json).not.toMatch(
        /PRIVATE_SENTINEL|contributor_key|account_id|raw_capture|machine_id|private_id|fictional-contributor/,
      );
    }
  });
  it('supports the maximum group page size and uses the exact-cohort index', async () => {
    const run = seedRows()[0]!;

    for (let index = 0; index < 51; index++) {
      await insert(
        {
          ...run,
          detail: { ...run.detail, hardware: { ...run.detail.hardware, ram_gb: 100 + index } },
        },
        `br_test_page_${index}`,
      );
    }

    const first = await groups('limit=50');
    expect(first.groups).toHaveLength(50);
    const second = await groups(`limit=50&cursor=${first.next_cursor}`);
    expect(second.groups).toHaveLength(4);
    expect(second.next_cursor).toBeNull();
    const orm = drizzle(db);
    const query = orm
      .select({ publicId: runs.publicId })
      .from(runs)
      .where(
        predicate(
          {
            cpu: fixtureCpuId,
            gpu: fixtureGpuId,
            ram_gb: 32,
            map: 'lighthouse',
            execution: 'bsg_servers',
            game_width: 2560,
            game_height: 1440,
            game_version: '0.16.9.0',
          },
          Number.MAX_SAFE_INTEGER,
        ),
      );

    // Inspect the generated runtime predicate, not a handwritten SQL equivalent.
    const plan = await orm.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query.getSQL()}`);
    expect(plan.map(row => row.detail).join(' ')).toContain('runs_hardware_cohort');
  });
  it('binds quoted version strings as exact values in search and Position', async () => {
    const version = "test' OR 1=1 --";
    const run = seedRows()[0]!;
    await insert(
      {
        ...run,
        detail: {
          ...run.detail,
          conditions: { ...run.detail.conditions, game_version: version },
        },
      },
      'br_test_quoted_version',
    );
    const result = await groups('game_version=' + encodeURIComponent(version));
    expect(result.summary).toEqual({ group_count: 1, run_count: 1, contributor_count: 1 });
    expect(result.groups[0]!.preview_runs[0]!.public_run_id).toBe('br_test_quoted_version');
    const matches = await position({ ...exact, game_version: version });
    expect(matches.runs.map(run => run.public_run_id)).toEqual(['br_test_quoted_version']);
    expect(
      (await groups('game_version=' + encodeURIComponent(version + 'x'))).summary.run_count,
    ).toBe(0);
  });
  it('preserves filter-option ordering and removes hidden-only values', async () => {
    const memory = new InMemoryBenchmarkRepository(
      seedRows().filter(row => row.visibility === 'published'),
    );
    expect(await new D1BenchmarkRepository(db, signingSecret).filterOptions()).toEqual(
      await memory.filterOptions(),
    );
    await db
      .prepare(
        `UPDATE benchmark_runs SET detail = json_set(detail,
      '$.conditions.game_version', 'hidden-only', '$.conditions.game_resolution.width', 999,
      '$.conditions.game_resolution.height', 888) WHERE visibility <> 'published'`,
      )
      .run();
    const options = await new D1BenchmarkRepository(db, signingSecret).filterOptions();
    expect(options.game_versions).not.toContain('hidden-only');
    expect(options.game_resolutions).not.toContainEqual({ width: 999, height: 888 });
  });
  it('serves empty production data and fails closed without the D1 binding', async () => {
    await db.prepare('DELETE FROM benchmark_runs').run();
    const live = createApp();
    const response = await live.request(
      `${base}/runs`,
      {},
      { BENCHMARK_DB: db, BENCHMARK_CURSOR_SECRET: signingSecret },
    );
    expect(groupSearchResponseSchema.parse(await response.json()).summary.run_count).toBe(0);
    expect((await groups('map=woods')).groups).toEqual([]);
    expect((await position()).status).toBe('no_data');
    expect(filterOptionsSchema.parse(await (await request(filterOptionsPath)).json()).cpus).toEqual(
      [],
    );
    expect((await live.request(`${base}/runs`)).status).toBe(500);
    await db.prepare('DROP TABLE benchmark_runs').run();
    expect(
      (
        await live.request(
          `${base}/runs`,
          {},
          { BENCHMARK_DB: db, BENCHMARK_CURSOR_SECRET: signingSecret },
        )
      ).status,
    ).toBe(500);
    expect(
      (
        await live.request(
          `${base}/filter-options`,
          {},
          { BENCHMARK_DB: db, BENCHMARK_CURSOR_SECRET: signingSecret },
        )
      ).status,
    ).toBe(500);
  });
});
