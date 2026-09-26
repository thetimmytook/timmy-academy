import { COHORT_RUNS_LIMIT, GROUP_PREVIEW_RUNS_LIMIT } from '@timmy/contracts';
import {
  cursorSchema,
  type BenchmarkFilters,
  type CohortQuery,
  type CohortResponse,
  type RunSearchQuery,
  type RunSearchResponse,
  type PublicRunDetail,
  type FilterOptions,
  type GroupRunsResponse,
} from '@timmy/contracts';

import { publicFilterOptions } from './filter-options';
import { createSyntheticRuns, syntheticMaps, type StoredRun } from './fixtures';
import { normalizeHardware } from './hardware-normalization';
import { projectDetail, projectHardware, projectSummary } from './projection';
import { BenchmarkRequestError, type BenchmarkRepository } from './repository';
import { searchFilters } from './search-filters';

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

function matches(run: StoredRun, filters: BenchmarkFilters): boolean {
  const { hardware, conditions } = run.detail;

  return (
    (filters.cpu === null || hardware.cpu.id === filters.cpu) &&
    (filters.gpu === null || hardware.gpu.id === filters.gpu) &&
    (filters.ram_gb === null || hardware.ram_gb === filters.ram_gb) &&
    (filters.map === null || conditions.map.id === filters.map) &&
    (filters.execution === null || conditions.execution === filters.execution) &&
    (filters.game_version === null || conditions.game_version === filters.game_version) &&
    (filters.game_width === null || conditions.game_resolution?.width === filters.game_width) &&
    (filters.game_height === null || conditions.game_resolution?.height === filters.game_height)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : Number(left > right);
}

function compareRuns(left: StoredRun, right: StoredRun): number {
  return (
    compareText(left.detail.captured_day, right.detail.captured_day) ||
    compareText(left.publishedAt, right.publishedAt) ||
    compareText(left.detail.public_run_id, right.detail.public_run_id)
  );
}

function counts(runs: readonly StoredRun[]): { run_count: number; contributor_count: number } {
  return {
    run_count: runs.length,
    contributor_count: new Set(runs.map(run => run.contributor)).size,
  };
}

function groupFacts(runs: readonly StoredRun[]): GroupRunsResponse['group'] {
  const first = runs[0];

  if (!first) {
    throw new Error('An empty hardware group cannot be projected.');
  }

  return {
    hardware: projectHardware(first),
    ...counts(runs),
    map_count: new Set(runs.map(run => run.detail.conditions.map.id)).size,
  };
}

function tuple(run: StoredRun): string {
  const hardware = run.detail.hardware;

  return JSON.stringify([hardware.cpu.id, hardware.gpu.id, hardware.ram_gb]);
}

// This immutable fixture snapshot is identical across Worker isolates. There is
// no process-local token registry or mutable data, and therefore no growing cache.
// Replacing the dataset invalidates old tokens instead of serving removed records.
export class InMemoryBenchmarkRepository implements BenchmarkRepository {
  private readonly runs: readonly StoredRun[];
  constructor(runs: readonly StoredRun[] = createSyntheticRuns()) {
    this.runs = structuredClone(runs);
  }

  detail(id: string): Promise<PublicRunDetail | undefined> {
    const run = this.runs.find(candidate => candidate.detail.public_run_id === id);

    return Promise.resolve(run === undefined ? undefined : projectDetail(run));
  }

  filterOptions(): Promise<FilterOptions> {
    return Promise.resolve(publicFilterOptions(this.runs.map(projectDetail)));
  }

  async search(query: RunSearchQuery): Promise<RunSearchResponse> {
    const filters = searchFilters(query);
    const snapshot = await digest(['synthetic-benchmark-v1', this.runs]);
    const binding = await digest([filters, query.sort]);
    const direction = query.sort === 'captured_asc' ? 1 : -1;
    const runs = this.runs
      .filter(run => matches(run, filters))
      .sort((left, right) => direction * compareRuns(left, right));
    const grouped = new Map<string, StoredRun[]>();

    for (const run of runs) {
      const key = tuple(run);
      const existing = grouped.get(key);

      if (existing) {
        existing.push(run);
      } else {
        grouped.set(key, [run]);
      }
    }

    // Insertion order is the first matching run's total order (day, publication, ID).
    const groups = await Promise.all(
      [...grouped].map(async ([key, members]) => ({
        key: `hg_${snapshot}_${binding}_${await digest(key)}`,
        members,
      })),
    );
    const cursorBinding = await digest([
      filters,
      query.view,
      query.group_key ?? null,
      query.sort,
      query.limit,
    ]);
    this.checkCursor(query.cursor, snapshot, cursorBinding);
    const common = { filters, sort: query.sort, limit: query.limit };

    if (query.view === 'items') {
      const key = query.group_key;

      if (!key) {
        throw new BenchmarkRequestError('invalid_input');
      }

      this.checkGroupKey(key, snapshot, binding);
      const group = groups.find(candidate => candidate.key === key);

      if (!group) {
        throw new BenchmarkRequestError('not_found');
      }

      const page = await this.page(group.members, query, snapshot, cursorBinding);

      return {
        ...common,
        view: 'items',
        group_key: key,
        group: groupFacts(group.members),
        items: page.items.map(projectSummary),
        next_cursor: page.next,
      };
    }

    const page = await this.page(groups, query, snapshot, cursorBinding);

    return {
      ...common,
      view: 'groups',
      summary: { ...counts(runs), group_count: groups.length },
      groups: page.items.map(group => {
        const seen = new Set<string>();
        const previews = group.members.filter(run => {
          const map = run.detail.conditions.map.id;

          if (seen.has(map) || seen.size === GROUP_PREVIEW_RUNS_LIMIT) {
            return false;
          }

          seen.add(map);

          return true;
        });

        return {
          ...groupFacts(group.members),
          group_key: group.key,
          preview_runs: previews.map(projectSummary),
          remaining_run_count: group.members.length - previews.length,
        };
      }),
      next_cursor: page.next,
    };
  }

  private checkCursor(cursor: string | undefined, snapshot: string, binding: string): void {
    if (cursor === undefined) {
      return;
    }

    if (
      !cursorSchema.safeParse(cursor).success ||
      !/^cur_[a-f0-9]{64}_[a-f0-9]{64}_[a-f0-9]{64}$/.test(cursor)
    ) {
      throw new BenchmarkRequestError('invalid_cursor');
    }

    const parts = cursor.split('_');

    if (parts[1] !== snapshot) {
      throw new BenchmarkRequestError('cursor_stale');
    }

    if (parts[2] !== binding) {
      throw new BenchmarkRequestError('invalid_cursor');
    }
  }

  private checkGroupKey(key: string, snapshot: string, binding: string): void {
    if (!/^hg_[a-f0-9]{64}_[a-f0-9]{64}_[a-f0-9]{64}$/.test(key)) {
      throw new BenchmarkRequestError('not_found');
    }

    const parts = key.split('_');

    if (parts[1] !== snapshot || parts[2] !== binding) {
      throw new BenchmarkRequestError('group_key_stale');
    }
  }

  private async page<T>(
    items: readonly T[],
    query: RunSearchQuery,
    snapshot: string,
    binding: string,
  ): Promise<{ items: T[]; next: string | null }> {
    const token = async (offset: number): Promise<string> =>
      `cur_${snapshot}_${binding}_${await digest(offset)}`;
    let start = 0;

    if (query.cursor !== undefined) {
      let found = false;

      for (let offset = query.limit; offset < items.length; offset += query.limit) {
        if ((await token(offset)) === query.cursor) {
          start = offset;
          found = true;
          break;
        }
      }

      if (!found) {
        throw new BenchmarkRequestError('invalid_cursor');
      }
    }

    const end = start + query.limit;

    return { items: items.slice(start, end), next: end < items.length ? await token(end) : null };
  }

  cohort(query: CohortQuery): Promise<CohortResponse> {
    return this.queryCohort(query);
  }

  private async queryCohort(query: CohortQuery): Promise<CohortResponse> {
    const hardware = await normalizeHardware(query.hardware);
    const { cpu, gpu } = hardware;
    const map = syntheticMaps.find(candidate => candidate.id === query.map);

    if (!map) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const criteria = {
      hardware,
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

    const exactCriteria = {
      ...criteria,
      game_resolution: query.game_resolution,
      game_version: query.game_version,
    };
    const exact = this.runs
      .filter(run =>
        matches(run, {
          cpu: cpu.id,
          gpu: gpu.id,
          ram_gb: query.hardware.ram_gb,
          map: map.id,
          execution: query.execution,
          game_width: query.game_resolution?.width ?? null,
          game_height: query.game_resolution?.height ?? null,
          game_version: query.game_version,
        }),
      )
      .sort((left, right) => -compareRuns(left, right));

    if (exact.length === 0) {
      return {
        status: 'no_data',
        criteria: exactCriteria,
        counts: { run_count: 0, contributor_count: 0 },
        runs: [],
        truncated: false,
        reason_codes: ['no_exact_matches'],
      };
    }

    return {
      status: 'matches',
      criteria: exactCriteria,
      counts: counts(exact),
      runs: exact.slice(0, COHORT_RUNS_LIMIT).map(projectSummary),
      truncated: exact.length > COHORT_RUNS_LIMIT,
      reason_codes: [],
    };
  }
}
