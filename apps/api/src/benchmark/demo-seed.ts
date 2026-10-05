import { publicRunDetailSchema } from '@timmy/contracts';
import { and, eq, notExists, sql } from 'drizzle-orm';
import { QueryBuilder, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

import { runs, submissions } from '../db/schema';

import { mapCatalog } from './catalog';
import { syntheticHardware, syntheticUmaHardware } from './fixture-hardware';
import { createResourceScenario, resourceScenarios } from './fixture-resource-scenarios';
import { createSyntheticRuns } from './fixtures';

import type { ResourceScenario } from './fixture-resource-scenarios';
import type { StoredRun } from './stored-run';
import type { PublicRunDetail } from '@timmy/contracts';

export function demoSeedRows(): StoredRun[] {
  const base = createSyntheticRuns()[0]!.detail;
  const rows = syntheticHardware.flatMap((_, hardwareIndex) =>
    mapCatalog.flatMap((_, mapIndex) => demoMapRows(hardwareIndex, mapIndex, base)),
  );
  const id = 'br_test_desktop_uma_lighthouse_local_1920_0';
  rows.push({
    contributor: 'fictional-desktop-uma-0',
    publishedAt: '2026-09-26T12:00:00Z',
    detail: publicRunDetailSchema.parse({
      ...base,
      public_run_id: id,
      url: `/bench/runs/${id}`,
      hardware: syntheticUmaHardware,
      conditions: {
        ...base.conditions,
        execution: 'local',
        game_resolution: { width: 1920, height: 1080 },
      },
      capture: { duration_sec: 120, sample_count: 4800 },
      metrics: {
        average_fps: 40,
        one_percent_low_fps: 28,
        zero_point_one_percent_low_fps: 20,
        average_frametime_ms: 25,
        p95_frametime_ms: 37.5,
        p99_frametime_ms: 50,
      },
      resource_telemetry: createResourceScenario(syntheticUmaHardware, 'uma'),
    }),
  });

  return rows;
}

function demoMapRows(hardwareIndex: number, mapIndex: number, base: PublicRunDetail): StoredRun[] {
  const hardware = syntheticHardware.at(hardwareIndex)!;
  const map = mapCatalog.at(mapIndex)!;
  const rows: StoredRun[] = [];
  let captureIndex = 0;

  for (const execution of ['bsg_servers', 'local'] as const) {
    for (const width of [1920, 2560]) {
      for (let sample = 0; sample < 3; sample++) {
        const id = `br_test_desktop_${hardwareIndex}_${map.id}_${execution}_${width}_${sample}`;
        const fps =
          140 - hardwareIndex * 25 - mapIndex * 3 - sample * 5 - (width === 2560 ? 15 : 0);
        const scenario = chooseDemoScenario(hardwareIndex, mapIndex, captureIndex++);
        rows.push({
          contributor: `fictional-desktop-${hardwareIndex}-${sample}`,
          publishedAt: '2026-09-26T12:00:00Z',
          detail: publicRunDetailSchema.parse({
            ...base,
            is_synthetic: true,
            public_run_id: id,
            url: `/bench/runs/${id}`,
            hardware,
            captured_day: `2026-09-${String(20 + sample).padStart(2, '0')}`,
            conditions: {
              ...base.conditions,
              map,
              execution,
              game_resolution: { width, height: width === 1920 ? 1080 : 1440 },
              game_version: '0.16.9.0',
            },
            capture: { duration_sec: 120, sample_count: fps * 120 },
            metrics: {
              average_fps: fps,
              one_percent_low_fps: fps * 0.7,
              zero_point_one_percent_low_fps: fps * 0.5,
              average_frametime_ms: 1000 / fps,
              p95_frametime_ms: 1500 / fps,
              p99_frametime_ms: 2000 / fps,
            },
            resource_telemetry: createResourceScenario(hardware, scenario),
          }),
        });
      }
    }
  }

  return rows;
}

function chooseDemoScenario(
  hardwareIndex: number,
  mapIndex: number,
  index: number,
): ResourceScenario {
  if (hardwareIndex !== 0 || mapIndex !== 0) {
    return 'normal';
  }

  return resourceScenarios.at(index) ?? 'normal';
}

export function demoSeedStatements(): string[] {
  const db = new QueryBuilder();
  const dialect = new SQLiteSyncDialect();
  const columns = [
    runs.publicId,
    runs.contributor,
    runs.publishedAt,
    runs.visibility,
    runs.detail,
    runs.isSynthetic,
  ].map(column => sql.identifier(column.name));
  const columnList = sql.join(columns, sql`, `);

  return demoSeedRows().map(run => {
    const deleted = db
      .select({ sequence: submissions.sequence })
      .from(submissions)
      .where(eq(submissions.deletedPublicId, run.detail.public_run_id));
    const linked = db
      .select({ sequence: submissions.sequence })
      .from(submissions)
      .where(eq(submissions.runSequence, runs.sequence));
    const telemetry = sql`json_extract("excluded"."detail", '$.resource_telemetry')`;
    const updateCondition = and(
      eq(runs.isSynthetic, true),
      eq(runs.contributor, run.contributor),
      notExists(linked),
      sql`json_extract(${runs.detail}, '$.resource_telemetry') IS NOT ${telemetry}`,
    );
    const query = sql`INSERT INTO ${runs} (${columnList})
      SELECT ${run.detail.public_run_id}, ${run.contributor}, ${run.publishedAt}, 'published', ${JSON.stringify(run.detail)}, 1
      WHERE ${notExists(deleted)}
      ON CONFLICT (${sql.identifier(runs.publicId.name)}) DO UPDATE
      SET ${sql.identifier(runs.detail.name)} = json_set(${runs.detail}, '$.resource_telemetry', ${telemetry})
      WHERE ${updateCondition}`;

    // Wrangler takes SQL text; Drizzle escapes all generated values. Conflict updates
    // touch telemetry alone and never change a row's ownership or publication state.
    return dialect.sqlToQuery(query.inlineParams()).sql + ';';
  });
}
