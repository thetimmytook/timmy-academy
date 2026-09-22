import { filterOptionsSchema, namedModelSchema } from '@timmy/contracts';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { runs } from '../db/schema';

import { hardwareCatalog, mapCatalog } from './catalog';
import {
  countFields,
  predicate,
  runColumns,
  runOrder,
  stored,
  type BenchmarkDatabase,
} from './d1-query';
import { namedOptions } from './filter-options';
import { projectSummary } from './projection';
import { BenchmarkRequestError } from './repository';

import type { FilterOptions, CohortQuery, CohortResponse } from '@timmy/contracts';

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

export async function queryCohort(
  db: BenchmarkDatabase,
  query: CohortQuery,
  watermark: number,
): Promise<CohortResponse> {
  const cpu = hardwareCatalog
    .map(item => item.cpu)
    .find(item => normalize(item.name) === normalize(query.hardware.cpu_name));
  const gpu = hardwareCatalog
    .map(item => item.gpu)
    .find(item => normalize(item.name) === normalize(query.hardware.gpu_name));
  const map = mapCatalog.find(item => item.id === query.map);

  if (!cpu || !gpu || !map) {
    throw new BenchmarkRequestError('invalid_input');
  }

  const criteria = {
    hardware: { cpu, gpu, ram_gb: query.hardware.ram_gb },
    map,
    execution: query.execution,
    game_resolution: query.game_resolution,
    game_version: query.game_version,
  };

  if (query.game_resolution === null || query.game_version === null) {
    const reason_codes: ('unknown_game_resolution' | 'game_version_missing')[] = [];

    if (query.game_resolution === null) {
      reason_codes.push('unknown_game_resolution');
    }

    if (query.game_version === null) {
      reason_codes.push('game_version_missing');
    }

    return {
      status: 'missing_conditions',
      criteria,
      counts: null,
      runs: [],
      truncated: false,
      reason_codes,
    };
  }

  const exact = {
    ...criteria,
    game_resolution: query.game_resolution,
    game_version: query.game_version,
  };
  const where = predicate(
    {
      cpu: cpu.id,
      gpu: gpu.id,
      ram_gb: query.hardware.ram_gb,
      map: map.id,
      execution: query.execution,
      game_width: query.game_resolution.width,
      game_height: query.game_resolution.height,
      game_version: query.game_version,
    },
    watermark,
  );
  const counts = await db.select(countFields).from(runs).where(where).get();

  if (!counts?.run_count) {
    return {
      status: 'no_data',
      criteria: exact,
      counts: { run_count: 0, contributor_count: 0 },
      runs: [],
      truncated: false,
      reason_codes: ['no_exact_matches'],
    };
  }

  const rows = await db
    .select(runColumns)
    .from(runs)
    .where(where)
    .orderBy(...runOrder(false))
    .limit(20)
    .all();

  return {
    status: 'matches',
    criteria: exact,
    counts,
    runs: rows.map(row => projectSummary(stored(row))),
    truncated: counts.run_count > 20,
    reason_codes: [],
  };
}

export async function queryFilterOptions(db: BenchmarkDatabase): Promise<FilterOptions> {
  const visible = eq(runs.visibility, 'published');

  const named = async (
    id: typeof runs.cpu | typeof runs.gpu | typeof runs.map,
    namePath: '$.hardware.cpu.name' | '$.hardware.gpu.name' | '$.conditions.map.name',
  ): Promise<{ id: string; name: string }[]> => {
    const rows = await db
      .selectDistinct({
        id,
        name: sql<string>`json_extract(${runs.detail}, ${namePath})`,
      })
      .from(runs)
      .where(visible)
      .all();

    return namedOptions(namedModelSchema.array().parse(rows));
  };

  const cpus = await named(runs.cpu, '$.hardware.cpu.name');
  const gpus = await named(runs.gpu, '$.hardware.gpu.name');
  const maps = await named(runs.map, '$.conditions.map.name');
  const ram = await db
    .selectDistinct({ ram: runs.ram })
    .from(runs)
    .where(visible)
    .orderBy(runs.ram)
    .all();
  const resolutions = await db
    .selectDistinct({ width: runs.width, height: runs.height })
    .from(runs)
    .where(and(visible, isNotNull(runs.width), isNotNull(runs.height)))
    .orderBy(runs.width, runs.height)
    .all();
  const versions = await db
    .selectDistinct({ version: runs.version })
    .from(runs)
    .where(and(visible, isNotNull(runs.version)))
    .all();
  const options = filterOptionsSchema.parse({
    cpus,
    gpus,
    maps,
    ram_gb: ram.map(row => row.ram),
    game_resolutions: resolutions,
    game_versions: versions.map(row => row.version),
  });

  options.game_versions.sort((a, b) => a.localeCompare(b));

  return options;
}
