import { and, count, countDistinct, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { runs } from '../db/schema';

import { groupPage } from './d1-groups';
import {
  cursorBinding,
  D1Navigation,
  groupBinding,
  type Navigation,
  type Snapshot,
} from './d1-navigation';
import { queryCohort, queryFilterOptions } from './d1-public-reads';
import {
  anchor,
  countFields,
  detail,
  pagePredicate,
  predicate,
  runOrder,
  stored,
  runColumns,
  type RunRow,
  type Tuple,
} from './d1-query';
import { projectHardware, projectSummary } from './projection';
import { BenchmarkRequestError, type BenchmarkRepository } from './repository';
import { searchFilters } from './search-filters';

import type { D1Database } from '@cloudflare/workers-types';
import type {
  PublicRunDetail,
  FilterOptions,
  CohortResponse,
  CohortQuery,
  GroupRunsResponse,
  GroupSearchResponse,
  RunSearchQuery,
  RunSearchResponse,
} from '@timmy/contracts';

export class D1BenchmarkRepository implements BenchmarkRepository {
  private readonly db;
  private readonly navigation;
  constructor(database: D1Database, signingSecret?: string) {
    // All statements use the primary. A session could route the final revision
    // check to a replica that has not observed a concurrent removal.
    this.db = drizzle(database);
    this.navigation = new D1Navigation(this.db, signingSecret);
  }
  async detail(id: string): Promise<PublicRunDetail | undefined> {
    const row = await this.db
      .select(runColumns)
      .from(runs)
      .where(and(eq(runs.publicId, id), eq(runs.visibility, 'published')))
      .get();

    return row ? detail(row) : undefined;
  }
  async filterOptions(): Promise<FilterOptions> {
    const snapshot = await this.navigation.snapshot();
    const result = await queryFilterOptions(this.db);
    await this.navigation.assertFresh(snapshot);

    return result;
  }
  async cohort(query: CohortQuery): Promise<CohortResponse> {
    const snapshot = await this.navigation.snapshot();
    const result = await queryCohort(this.db, query, snapshot.watermark);
    await this.navigation.assertFresh(snapshot);

    return result;
  }
  async search(query: RunSearchQuery): Promise<RunSearchResponse> {
    // Cursor binding is checked before group expiry to preserve 400 vs 409 semantics.
    const cursor =
      query.cursor === undefined
        ? undefined
        : await this.navigation.read(query.cursor, cursorBinding(query), 'cur');
    const group =
      query.group_key === undefined
        ? undefined
        : await this.navigation.read(query.group_key, groupBinding(query), 'hg');
    const resumed =
      query.snapshot === undefined
        ? undefined
        : await this.navigation.read(query.snapshot, groupBinding(query), 'hg');
    const snapshot =
      cursor?.snapshot ??
      group?.snapshot ??
      resumed?.snapshot ??
      (await this.navigation.snapshot());

    for (const navigation of [group, resumed]) {
      if (navigation && JSON.stringify(navigation.snapshot) !== JSON.stringify(snapshot)) {
        throw new BenchmarkRequestError('group_key_stale');
      }
    }

    const result =
      query.view === 'groups'
        ? await this.groups(query, snapshot, cursor)
        : await this.items(query, snapshot, group, cursor);

    // Catch removal between separate SQL statements; never return a mixed snapshot.
    const staleCode = !query.cursor && query.group_key ? 'group_key_stale' : 'cursor_stale';
    await this.navigation.assertFresh(snapshot, staleCode);

    return result;
  }
  private async next(
    query: RunSearchQuery,
    snapshot: Snapshot,
    rows: RunRow[],
  ): Promise<string | null> {
    const last = rows.at(query.limit - 1);

    return rows.length > query.limit && last
      ? this.navigation.save('cur', {
          snapshot,
          binding: cursorBinding(query),
          after: anchor(last),
        })
      : null;
  }
  private async facts(
    query: RunSearchQuery,
    snapshot: Snapshot,
    hardware: Tuple,
    first: RunRow,
  ): Promise<GroupRunsResponse['group']> {
    const where = predicate(searchFilters(query), snapshot.watermark, hardware);
    const counts = await this.db
      .select({ ...countFields, map_count: countDistinct(runs.map) })
      .from(runs)
      .where(where)
      .get();

    if (!counts?.run_count) {
      throw new BenchmarkRequestError('group_key_stale');
    }

    return { hardware: projectHardware(stored(first)), ...counts };
  }
  private async items(
    query: RunSearchQuery,
    snapshot: Snapshot,
    group?: Navigation,
    cursor?: Navigation,
  ): Promise<GroupRunsResponse> {
    if (!group?.hardware || !query.group_key) {
      throw new BenchmarkRequestError('group_key_stale');
    }

    const where = predicate(searchFilters(query), snapshot.watermark, group.hardware);
    const page = pagePredicate(query.sort === 'captured_asc', cursor?.after);
    const rows = await this.db
      .select(runColumns)
      .from(runs)
      .where(and(where, page))
      .orderBy(...runOrder(query.sort === 'captured_asc'))
      .limit(query.limit + 1)
      .all();
    const first = rows[0];

    if (!first) {
      throw new BenchmarkRequestError('group_key_stale');
    }

    return {
      view: 'items',
      filters: searchFilters(query),
      sort: query.sort,
      limit: query.limit,
      group_key: query.group_key,
      group: await this.facts(query, snapshot, group.hardware, first),
      items: rows.slice(0, query.limit).map(row => projectSummary(stored(row))),
      next_cursor: await this.next(query, snapshot, rows),
    };
  }
  private async groups(
    query: RunSearchQuery,
    snapshot: Snapshot,
    cursor?: Navigation,
  ): Promise<GroupSearchResponse> {
    const filters = searchFilters(query);
    const where = predicate(filters, snapshot.watermark);
    const distinctGroups = this.db
      .select({ cpu: runs.cpu, gpu: runs.gpu, ram: runs.ram })
      .from(runs)
      .where(where)
      .groupBy(runs.cpu, runs.gpu, runs.ram)
      .as('matching_groups');
    const groupCount = this.db.select({ value: count() }).from(distinctGroups);
    const totals = await this.db
      .select({ ...countFields, group_count: sql<number>`(${groupCount})`.mapWith(Number) })
      .from(runs)
      .where(where)
      .get();
    const result = await groupPage(this.db, this.navigation, query, snapshot, cursor?.after);

    if (!totals) {
      throw new Error('Missing search totals.');
    }

    return {
      view: 'groups',
      filters,
      sort: query.sort,
      limit: query.limit,
      summary: totals,
      groups: result.groups,
      next_cursor: await this.next(query, snapshot, result.rows),
    };
  }
}
