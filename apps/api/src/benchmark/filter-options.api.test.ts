import { filterOptionsSchema } from '@timmy/contracts';
import { describe, expect, it } from 'vitest';

import { createApp } from '../index';

import { createSyntheticRuns } from './fixtures';
import { InMemoryBenchmarkRepository } from './in-memory-repository';

const path = '/api/bench/v1/filter-options';
describe('public filter options', () => {
  it('returns only distinct observed public fields, omitting unknown conditions', async () => {
    const run = createSyntheticRuns()[0]!;
    run.detail.conditions.game_resolution = null;
    run.detail.conditions.game_version = null;
    const app = createApp(new InMemoryBenchmarkRepository([run, run]));
    const response = await app.request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(filterOptionsSchema.parse(await response.json())).toEqual({
      cpus: [run.detail.hardware.cpu],
      gpus: [run.detail.hardware.gpu],
      ram_gb: [run.detail.hardware.ram_gb],
      maps: [run.detail.conditions.map],
      game_resolutions: [],
      game_versions: [],
    });
  });
  it('does not fall back to a fixture catalog for an empty public dataset', async () => {
    const app = createApp(new InMemoryBenchmarkRepository([]));
    expect(await (await app.request(path)).json()).toEqual({
      cpus: [],
      gpus: [],
      ram_gb: [],
      maps: [],
      game_resolutions: [],
      game_versions: [],
    });
    expect((await app.request(`${path}?cpu=anything`)).status).toBe(422);
  });
});
