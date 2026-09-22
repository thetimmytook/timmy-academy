import {
  benchmarkErrorSchema,
  cohortResponseSchema,
  groupRunsResponseSchema,
  groupSearchResponseSchema,
  publicRunDetailSchema,
  type CohortQuery,
} from '@timmy/contracts';
import { describe, expect, it } from 'vitest';

import { createApp } from '../index';

import { createSyntheticRuns } from './fixtures';
import { InMemoryBenchmarkRepository } from './in-memory-repository';

import type { BenchmarkRepository } from './repository';

const base = '/api/bench/v1';
const missingGroup = 'Expected fixture group.';
const missingRun = 'Expected fixture run.';
const exact: CohortQuery = {
  hardware: { cpu_name: 'Ryzen 7 7800X3D', gpu_name: 'GeForce RTX 4070 SUPER', ram_gb: 32 },
  map: 'lighthouse',
  execution: 'bsg_servers',
  game_resolution: { width: 2560, height: 1440 },
  game_version: '0.16.9.0',
};
const app = createApp();
async function groups(query = '', application = app) {
  const response = await application.request(`${base}/runs?${query}`);
  expect(response.status).toBe(200);
  return groupSearchResponseSchema.parse(await response.json());
}
async function position(body: unknown = exact, application = app) {
  const response = await application.request(`${base}/cohorts/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return cohortResponseSchema.parse(await response.json());
}
async function errorAt(path: string, status: number, code: string, application = app) {
  const response = await application.request(`${base}${path}`);
  expect(response.status).toBe(status);
  const error = benchmarkErrorSchema.parse(await response.json());
  expect(error.code).toBe(code);
  expect(error.request_id).toMatch(/^req_/);
}

describe('public search and navigation', () => {
  it('returns exact CPU/GPU/RAM groups and individual previews with distinct map counts', async () => {
    const result = await groups();
    expect(result.summary).toEqual({ group_count: 3, run_count: 24, contributor_count: 6 });
    expect(result.groups.map(group => group.hardware.ram_gb).sort((a, b) => a - b)).toEqual([
      16, 32, 64,
    ]);
    for (const group of result.groups) {
      expect(group).toMatchObject({
        run_count: 8,
        map_count: 4,
        contributor_count: 2,
        remaining_run_count: 5,
      });
      expect(new Set(group.preview_runs.map(run => run.map.id)).size).toBe(3);
    }
  });
  it.each([
    ['cpu=ryzen-7-7800x3d', 16, 2],
    ['gpu=geforce-rtx-3060-ti', 8, 1],
    ['ram_gb=64', 8, 1],
    ['map=lighthouse', 6, 3],
    ['execution=local', 6, 3],
    ['game_width=1920&game_height=1080', 3, 3],
    ['game_version=0.16.8.0', 3, 3],
    [
      'cpu=ryzen-7-7800x3d&gpu=geforce-rtx-4070-super&ram_gb=32&map=lighthouse&execution=bsg_servers&game_width=2560&game_height=1440&game_version=0.16.9.0',
      2,
      1,
    ],
    ['cpu=ryzen-7-7800x3d&gpu=geforce-rtx-3060-ti', 0, 0],
    ['ram_gb=48', 0, 0],
    ['game_version=0.0.0.0', 0, 0],
  ])('applies AND filters without widening: %s', async (query, runs, count) => {
    expect((await groups(query)).summary).toMatchObject({ run_count: runs, group_count: count });
  });
  it('navigates group → every run → details, preserving raw metrics and unknown values', async () => {
    const result = await groups('ram_gb=32');
    const group = result.groups[0];
    if (!group) throw new Error(missingGroup);
    const response = await app.request(
      `${base}/runs?view=items&ram_gb=32&group_key=${group.group_key}`,
    );
    const items = groupRunsResponseSchema.parse(await response.json());
    expect(items.items).toHaveLength(8);
    for (const item of items.items) {
      const response = await app.request(`${base}/runs/${item.public_run_id}`);
      const detail = publicRunDetailSchema.parse(await response.json());
      expect(detail.public_run_id).toBe(item.public_run_id);
      expect(detail.url).toBe(item.url);
      expect(detail.hardware.ram_gb).toBe(32);
      expect(detail.metrics.average_fps).toBe(item.metrics.average_fps);
      expect(detail.conditions.game_resolution).toEqual(item.game_resolution);
    }
    expect(items.items.some(run => run.game_resolution === null)).toBe(true);
    expect(items.items.some(run => run.game_version === null)).toBe(true);
    expect((await groups('ram_gb=32&game_version=0.16.9.0')).summary.run_count).toBe(6);
    expect((await groups('ram_gb=32&game_width=2560&game_height=1440')).summary.run_count).toBe(6);
  });
  it.each(['captured_asc', 'captured_desc'])(
    'has stable group and item pagination in %s order across instances',
    async sort => {
      const application = createApp();
      const first = await groups(`sort=${sort}&limit=1`);
      const allKeys: string[] = [];
      let page = first;
      while (true) {
        allKeys.push(...page.groups.map(group => group.group_key));
        if (!page.next_cursor) break;
        page = await groups(`sort=${sort}&limit=1&cursor=${page.next_cursor}`, application);
      }
      expect(allKeys).toHaveLength(3);
      expect(new Set(allKeys).size).toBe(3);
      const group = first.groups[0];
      if (!group) throw new Error(missingGroup);
      const query = `view=items&group_key=${group.group_key}&sort=${sort}&limit=2`;
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const continuation = cursor ? `&cursor=${cursor}` : '';
        const response = await application.request(`${base}/runs?${query}${continuation}`);
        const items = groupRunsResponseSchema.parse(await response.json());
        ids.push(...items.items.map(run => run.public_run_id));
        cursor = items.next_cursor;
      } while (cursor);
      const full = groupRunsResponseSchema.parse(
        await (
          await app.request(`${base}/runs?view=items&group_key=${group.group_key}&sort=${sort}`)
        ).json(),
      );
      expect(ids).toEqual(full.items.map(run => run.public_run_id));
      expect(new Set(ids).size).toBe(8);
      expect(await groups(`sort=${sort}&limit=1`)).toEqual(first);
    },
  );
  it('orders tied days by publication time then public ID, reversing all tie breakers', async () => {
    const fixtures = createSyntheticRuns()
      .slice(0, 3)
      .map(run => ({
        ...run,
        publishedAt: '2026-09-20T00:00:00Z',
        detail: { ...run.detail, captured_day: '2026-09-19' },
      }));
    const application = createApp(new InMemoryBenchmarkRepository(fixtures));
    for (const sort of ['captured_asc', 'captured_desc']) {
      const first = (await groups(`sort=${sort}`, application)).groups[0];
      if (!first) throw new Error(missingGroup);
      const response = await application.request(
        `${base}/runs?view=items&sort=${sort}&group_key=${first.group_key}`,
      );
      const items = groupRunsResponseSchema.parse(await response.json());
      const expected = fixtures
        .map(run => run.detail.public_run_id)
        .sort((left, right) => (left < right ? -1 : Number(left > right)));
      if (sort === 'captured_desc') expected.reverse();
      expect(items.items.map(run => run.public_run_id)).toEqual(expected);
    }
  });
  it('binds cursors to filters, view, group, sort and limit', async () => {
    const first = await groups('limit=1');
    for (const query of [
      'limit=2',
      'limit=1&sort=captured_asc',
      'limit=1&ram_gb=32',
      'limit=1&cpu=core-i5-12400f',
    ]) {
      await errorAt(`/runs?${query}&cursor=${first.next_cursor}`, 400, 'invalid_cursor');
    }
    const group = first.groups[0];
    if (!group) throw new Error(missingGroup);
    await errorAt(
      `/runs?view=items&group_key=${group.group_key}&limit=1&cursor=${first.next_cursor}`,
      400,
      'invalid_cursor',
    );
    await errorAt(
      `/runs?view=items&group_key=${group.group_key}&ram_gb=32`,
      409,
      'group_key_stale',
    );
    await errorAt(
      `/runs?view=items&group_key=${group.group_key}&sort=captured_asc`,
      409,
      'group_key_stale',
    );
    const itemPage = groupRunsResponseSchema.parse(
      await (
        await app.request(`${base}/runs?view=items&group_key=${group.group_key}&limit=1`)
      ).json(),
    );
    const other = (await groups()).groups.find(
      candidate => candidate.group_key !== group.group_key,
    );
    if (!other) throw new Error('Expected another group.');
    await errorAt(
      `/runs?view=items&group_key=${other.group_key}&limit=1&cursor=${itemPage.next_cursor}`,
      400,
      'invalid_cursor',
    );
    await errorAt('/runs?cursor=garbage', 400, 'invalid_cursor');
  });
  it('invalidates snapshots after removal or publication rather than skipping or repeating results', async () => {
    const before = await groups('limit=1');
    const key = before.groups[0]?.group_key;
    const fixtures = createSyntheticRuns();
    const removed = fixtures[0];
    if (!removed) throw new Error(missingRun);
    const afterRemoval = createApp(new InMemoryBenchmarkRepository(fixtures.slice(1)));
    await errorAt(`/runs?limit=1&cursor=${before.next_cursor}`, 409, 'cursor_stale', afterRemoval);
    await errorAt(`/runs?view=items&group_key=${key}`, 409, 'group_key_stale', afterRemoval);
    await errorAt(`/runs/${removed.detail.public_run_id}`, 404, 'not_found', afterRemoval);
    const afterPublication = createApp(
      new InMemoryBenchmarkRepository([
        ...fixtures,
        { ...removed, detail: { ...removed.detail, public_run_id: 'br_AnotherSynthetic' } },
      ]),
    );
    await errorAt(
      `/runs?limit=1&cursor=${before.next_cursor}`,
      409,
      'cursor_stale',
      afterPublication,
    );
  });
  it.each(['/runs/br_unknown', '/runs?view=items&group_key=hg_unknown'])(
    'returns not_found for %s',
    async path => {
      await errorAt(path, 404, 'not_found');
    },
  );
  it.each([
    'limit=0',
    'limit=51',
    'game_width=1920',
    'execution=pve',
    'view=items',
    'ram_gb=32&ram_gb=64',
    'settings.foo=bar',
    'email=secret@example.test',
  ])('rejects invalid queries: %s', async query => {
    await errorAt(`/runs?${query}`, 422, 'invalid_input');
  });
});

describe('exact Position comparison', () => {
  it('keeps individual FPS and counts runs separately from contributors despite different graphics', async () => {
    const result = await position();
    expect(result.status).toBe('matches');
    expect(result.counts).toEqual({ run_count: 2, contributor_count: 1 });
    expect(result.runs.map(run => run.metrics.average_fps)).toEqual([120, 108]);
    expect(result.truncated).toBe(false);
    expect(result.reason_codes).toEqual([]);
  });
  it.each([
    { hardware: { ...exact.hardware, ram_gb: 48 } },
    { hardware: { ...exact.hardware, gpu_name: 'GeForce RTX 3060 Ti' } },
    { hardware: { ...exact.hardware, cpu_name: 'Core i5-12400F' } },
    { map: 'woods' },
    { execution: 'local' },
    { game_resolution: { width: 1920, height: 1080 } },
    { game_version: '0.16.8.0' },
  ])('does not widen missing exact matches: %j', async change => {
    expect(await position({ ...exact, ...change })).toMatchObject({
      status: 'no_data',
      counts: { run_count: 0, contributor_count: 0 },
      runs: [],
      reason_codes: ['no_exact_matches'],
    });
  });
  it('reports missing conditions without treating unknown as a matching value', async () => {
    expect(await position({ ...exact, game_resolution: null, game_version: null })).toMatchObject({
      status: 'missing_conditions',
      counts: null,
      runs: [],
      truncated: false,
      reason_codes: ['unknown_game_resolution', 'game_version_missing'],
    });
  });
  it('normalizes only known fixture hardware names and returns canonical criteria', async () => {
    const result = await position({
      ...exact,
      hardware: { ...exact.hardware, cpu_name: '  ryzen 7 7800x3d  ' },
    });
    expect(result.criteria.hardware.cpu).toEqual({
      id: 'ryzen-7-7800x3d',
      name: 'Ryzen 7 7800X3D',
    });
  });
  it('bounds examples to 20 while retaining full counts', async () => {
    const first = createSyntheticRuns()[0];
    if (!first) throw new Error(missingRun);
    const runs = Array.from({ length: 23 }, (_, index) => ({
      ...first,
      detail: { ...first.detail, public_run_id: `br_synthetic${index}` },
    }));
    const result = await position(exact, createApp(new InMemoryBenchmarkRepository(runs)));
    expect(result.runs).toHaveLength(20);
    expect(result.counts).toEqual({ run_count: 23, contributor_count: 1 });
    expect(result.truncated).toBe(true);
  });
  it.each([
    '{',
    'null',
    JSON.stringify({ ...exact, email: 'private@example.test' }),
    JSON.stringify({ ...exact, hardware: { ...exact.hardware, serial_number: 'private' } }),
  ])('rejects malformed and extra-key bodies without echoing values', async body => {
    const response = await app.request(`${base}/cohorts/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(response.status).toBe(422);
    const error = benchmarkErrorSchema.parse(await response.json());
    expect(error.code).toBe('invalid_input');
    expect(JSON.stringify(error)).not.toContain('private');
  });
});

describe('public allowlist and error privacy', () => {
  const privateFields = {
    email: 'secret@example.test',
    account_id: 'secret-account',
    client_run_id: 'secret-client',
    path: 'C:/secret',
    hostname: 'secret-host',
    username: 'secret-user',
    ip: '192.0.2.99',
    serial_number: 'secret-serial',
    machine_id: 'secret-machine',
    raw_capture: 'secret-capture',
    settings_snapshot: 'secret-settings',
    session: 'secret-session',
    moderation_notes: 'secret-notes',
  };
  it('excludes private fields injected into stored records from every anonymous response', async () => {
    const runs = createSyntheticRuns().map(run => ({
      ...run,
      ...privateFields,
      detail: {
        ...run.detail,
        ...privateFields,
        hardware: { ...run.detail.hardware, ...privateFields },
        metrics: { ...run.detail.metrics, ...privateFields },
        capture: { ...run.detail.capture, ...privateFields },
        conditions: { ...run.detail.conditions, ...privateFields },
      },
    }));
    const application = createApp(new InMemoryBenchmarkRepository(runs));
    const search = await groups('', application);
    const group = search.groups[0];
    const run = runs[0];
    if (!group || !run) throw new Error('Expected fixtures.');
    const detail = publicRunDetailSchema.parse(
      await (await application.request(`${base}/runs/${run.detail.public_run_id}`)).json(),
    );
    const items = groupRunsResponseSchema.parse(
      await (
        await application.request(`${base}/runs?view=items&group_key=${group.group_key}`)
      ).json(),
    );
    const cohort = await position(exact, application);
    for (const output of [search, items, detail, cohort]) {
      const json = JSON.stringify(output);
      for (const [key, value] of Object.entries(privateFields)) {
        expect(json).not.toContain(`"${key}"`);
        expect(json).not.toContain(value);
      }
      for (const key of ['rank', 'percentile', 'normalized_fps', 'contributor_id', 'publishedAt'])
        expect(json).not.toContain(`"${key}"`);
    }
    expect(detail.settings?.graphics?.texture_quality_code).toBe(0);
    expect(detail.conditions.game_resolution).toEqual({ width: 2560, height: 1440 });
  });
  it('selects public settings without rejecting private internal fields', async () => {
    const first = createSyntheticRuns()[0];
    if (!first) throw new Error(missingRun);
    const poisoned = {
      ...first,
      detail: {
        ...first.detail,
        settings: {
          ...first.detail.settings,
          ...privateFields,
          game: { ...first.detail.settings?.game, ...privateFields },
          graphics: { ...first.detail.settings?.graphics, ...privateFields },
          postfx: { ...first.detail.settings?.postfx, ...privateFields },
        },
      },
    };
    const application = createApp(new InMemoryBenchmarkRepository([poisoned]));
    const response = await application.request(`${base}/runs/${first.detail.public_run_id}`);
    expect(response.status).toBe(200);
    const detail = publicRunDetailSchema.parse(await response.json());
    expect(detail.settings).toEqual(first.detail.settings);
    for (const [key, value] of Object.entries(privateFields)) {
      expect(JSON.stringify(detail)).not.toContain(`"${key}"`);
      expect(JSON.stringify(detail)).not.toContain(value);
    }
  });
  it('masks internal exceptions', async () => {
    const failingRepository: BenchmarkRepository = {
      search() {
        throw new Error('secret SQL path stack account_id');
      },
      detail() {
        throw new Error('secret');
      },
      cohort() {
        throw new Error('secret');
      },
    };
    await errorAt('/runs', 500, 'internal_error', createApp(failingRepository));
  });
  it('has no publication or owner routes', async () => {
    const before = await groups();
    expect((await app.request(`${base}/me/runs`, { method: 'POST', body: '{}' })).status).toBe(404);
    await position();
    expect(await groups()).toEqual(before);
  });
  it('rejects unknown fields on detail and Position requests and prevents response caching', async () => {
    const first = createSyntheticRuns()[0];
    if (!first) throw new Error(missingRun);
    await errorAt(`/runs/${first.detail.public_run_id}?email=private`, 422, 'invalid_input');
    const response = await app.request(`${base}/cohorts/query?private=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(exact),
    });
    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await app.request(`${base}/runs`)).headers.get('cache-control')).toBe('no-store');
  });
});
