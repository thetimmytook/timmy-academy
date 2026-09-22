import { and, count, countDistinct, eq, sql } from 'drizzle-orm';

import { runs } from '../db/schema';

import { groupBinding, type D1Navigation, type Snapshot } from './d1-navigation';
import {
  pagePredicate,
  predicate,
  runColumns,
  runFields,
  runOrder,
  stored,
  tuple,
} from './d1-query';
import { projectHardware, projectSummary } from './projection';
import { searchFilters } from './search-filters';

import type { Anchor, BenchmarkDatabase } from './d1-query';
import type { GroupSearchResponse, PublicRunDetail, RunSearchQuery } from '@timmy/contracts';

// A single SQLite statement: filtered rows, windows, counts and <= 3 preview
// documents/group stay in the database. No per-group queries or JS table scan.
export async function groupPage(
  db: BenchmarkDatabase,
  navigation: D1Navigation,
  query: RunSearchQuery,
  snapshot: Snapshot,
  after?: Anchor,
) {
  const ascending = query.sort === 'captured_asc';
  const filtered = db.$with('filtered').as(
    db
      .select({ ...runColumns, map: runs.map })
      .from(runs)
      .where(predicate(searchFilters(query), snapshot.watermark)),
  );
  const filteredOrder = sql.join(runOrder(ascending, filtered), sql`, `);
  const ranked = db.$with('ranked').as(
    db
      .select({
        ...runFields(filtered),
        position:
          sql<number>`row_number() over (partition by ${filtered.cpu}, ${filtered.gpu}, ${filtered.ram}
      order by ${filteredOrder})`.as('position'),
      })
      .from(filtered),
  );
  const facts = db.$with('facts').as(
    db
      .select({
        cpu: filtered.cpu,
        gpu: filtered.gpu,
        ram: filtered.ram,
        run_count: count().as('run_count'),
        contributor_count: countDistinct(filtered.contributor).as('contributor_count'),
        map_count: countDistinct(filtered.map).as('map_count'),
      })
      .from(filtered)
      .groupBy(filtered.cpu, filtered.gpu, filtered.ram),
  );
  const maps = db.$with('maps').as(
    db
      .select({
        ...runFields(filtered),
        mapPosition:
          sql<number>`row_number() over (partition by ${filtered.cpu}, ${filtered.gpu}, ${filtered.ram}, ${filtered.map}
      order by ${filteredOrder})`.as('map_position'),
      })
      .from(filtered),
  );
  const heads = db.$with('heads').as(
    db
      .select(runFields(ranked))
      .from(ranked)
      .where(and(eq(ranked.position, 1), pagePredicate(ascending, after, ranked)))
      .orderBy(...runOrder(ascending, ranked))
      .limit(query.limit + 1),
  );
  const preview = db
    .select({ detail: maps.detail })
    .from(maps)
    .where(
      and(
        eq(maps.cpu, heads.cpu),
        eq(maps.gpu, heads.gpu),
        eq(maps.ram, heads.ram),
        eq(maps.mapPosition, 1),
      ),
    )
    .orderBy(...runOrder(ascending, maps))
    .limit(3)
    .as('preview');

  // The ordered/limited correlated subquery must be aggregated as a whole, not
  // before LIMIT. This small SQLite JSON aggregate is expressed with Drizzle sql.
  const previews = sql<string>`(select json_group_array(json(${preview.detail})) from ${preview})`;
  const rows = await db
    .with(filtered, ranked, facts, maps, heads)
    .select({
      ...runFields(heads),
      run_count: facts.run_count,
      contributor_count: facts.contributor_count,
      map_count: facts.map_count,
      previews,
    })
    .from(heads)
    .innerJoin(
      facts,
      and(eq(heads.cpu, facts.cpu), eq(heads.gpu, facts.gpu), eq(heads.ram, facts.ram)),
    )
    .orderBy(...runOrder(ascending, heads))
    .all();
  const selected = rows.slice(0, query.limit);
  const keys = await navigation.saveGroups(
    selected.map(row => ({ snapshot, binding: groupBinding(query), hardware: tuple(row) })),
  );
  const groups: GroupSearchResponse['groups'] = selected.map((row, index) => {
    const documents = JSON.parse(row.previews) as PublicRunDetail[];
    const key = keys.at(index);

    if (!key) {
      throw new Error('Missing navigation token.');
    }

    return {
      hardware: projectHardware(stored(row)),
      run_count: row.run_count,
      map_count: row.map_count,
      contributor_count: row.contributor_count,
      group_key: key,
      preview_runs: documents.map(document =>
        projectSummary(stored({ ...row, detail: JSON.stringify(document) })),
      ),
      remaining_run_count: row.run_count - documents.length,
    };
  });

  return { rows, groups };
}
