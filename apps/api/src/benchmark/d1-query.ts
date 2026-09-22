import { and, asc, count, countDistinct, desc, eq, gt, lt, lte, sql } from 'drizzle-orm';

import { runs } from '../db/schema';

import { projectDetail } from './projection';

import type { StoredRun } from './stored-run';
import type { BenchmarkFilters, PublicRunDetail } from '@timmy/contracts';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export type BenchmarkDatabase = DrizzleD1Database;
export const runColumns = {
  detail: runs.detail,
  contributor: runs.contributor,
  publishedAt: runs.publishedAt,
  publicId: runs.publicId,
  day: runs.day,
  cpu: runs.cpu,
  gpu: runs.gpu,
  ram: runs.ram,
};
export type RunRow = Pick<typeof runs.$inferSelect, keyof typeof runColumns>;

// Preserve Drizzle's inferred column types when selecting from a CTE alias.
export function runFields<T extends Record<keyof typeof runColumns, AnySQLiteColumn>>(
  source: T,
): Record<keyof typeof runColumns, AnySQLiteColumn> {
  return {
    detail: source.detail,
    contributor: source.contributor,
    publishedAt: source.publishedAt,
    publicId: source.publicId,
    day: source.day,
    cpu: source.cpu,
    gpu: source.gpu,
    ram: source.ram,
  };
}

export type Anchor = [string, string, string];
export type Tuple = [string, string, number];
type OrderFields = Record<'day' | 'publishedAt' | 'publicId', SQLWrapper>;

export function runOrder(ascending: boolean, source: OrderFields = runs): SQL<unknown>[] {
  const direction = ascending ? asc : desc;

  return [direction(source.day), direction(source.publishedAt), direction(source.publicId)];
}

export function pagePredicate(
  ascending: boolean,
  after?: Anchor,
  source: OrderFields = runs,
): SQL<unknown> | undefined {
  if (!after) {
    return undefined;
  }

  const compare = ascending ? gt : lt;

  return compare(
    sql`(${source.day}, ${source.publishedAt}, ${source.publicId})`,
    sql`(${after[0]}, ${after[1]}, ${after[2]})`,
  );
}

export function anchor(row: RunRow): Anchor {
  if (row.day === null) {
    throw new Error('A public run must have a capture day.');
  }

  return [row.day, row.publishedAt, row.publicId];
}

export function tuple(row: RunRow): Tuple {
  if (row.cpu === null || row.gpu === null || row.ram === null) {
    throw new Error('A public run must have a hardware tuple.');
  }

  return [row.cpu, row.gpu, row.ram];
}

export function stored(row: Pick<RunRow, 'detail' | 'contributor' | 'publishedAt'>): StoredRun {
  return {
    detail: JSON.parse(row.detail) as PublicRunDetail,
    contributor: row.contributor,
    publishedAt: row.publishedAt,
  };
}

export function detail(row: RunRow): PublicRunDetail {
  return projectDetail(stored(row));
}

export function predicate(
  filters: BenchmarkFilters,
  watermark: number,
  hardware?: Tuple,
): SQL<unknown> | undefined {
  return and(
    eq(runs.visibility, 'published'),
    lte(runs.sequence, watermark),
    filters.cpu === null ? undefined : eq(runs.cpu, filters.cpu),
    filters.gpu === null ? undefined : eq(runs.gpu, filters.gpu),
    filters.ram_gb === null ? undefined : eq(runs.ram, filters.ram_gb),
    filters.map === null ? undefined : eq(runs.map, filters.map),
    filters.execution === null ? undefined : eq(runs.execution, filters.execution),
    filters.game_width === null ? undefined : eq(runs.width, filters.game_width),
    filters.game_height === null ? undefined : eq(runs.height, filters.game_height),
    filters.game_version === null ? undefined : eq(runs.version, filters.game_version),
    hardware
      ? and(eq(runs.cpu, hardware[0]), eq(runs.gpu, hardware[1]), eq(runs.ram, hardware[2]))
      : undefined,
  );
}

export const countFields = {
  run_count: count(),
  contributor_count: countDistinct(runs.contributor),
};
