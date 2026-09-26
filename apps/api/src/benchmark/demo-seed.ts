import { publicRunDetailSchema } from '@timmy/contracts';

import { mapCatalog } from './catalog';
import { syntheticHardware } from './fixture-hardware';
import { createSyntheticRuns } from './fixtures';

export function demoSeedStatements(): string[] {
  return syntheticHardware.flatMap((_, hardwareIndex) =>
    mapCatalog.flatMap((_, mapIndex) => demoMapStatements(hardwareIndex, mapIndex)),
  );
}

function demoMapStatements(hardwareIndex: number, mapIndex: number): string[] {
  const hardware = syntheticHardware.at(hardwareIndex)!;
  const map = mapCatalog.at(mapIndex)!;
  const base = createSyntheticRuns()[0]!.detail;
  const statements: string[] = [];
  const quote = (value: string): string => "'" + value.replaceAll("'", "''") + "'";

  for (const execution of ['bsg_servers', 'local'] as const) {
    for (const width of [1920, 2560]) {
      for (let sample = 0; sample < 3; sample++) {
        const id = `br_test_desktop_${hardwareIndex}_${map.id}_${execution}_${width}_${sample}`;
        const fps =
          140 - hardwareIndex * 25 - mapIndex * 3 - sample * 5 - (width === 2560 ? 15 : 0);
        const detail = publicRunDetailSchema.parse({
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
        });
        const contributor = `fictional-desktop-${hardwareIndex}-${sample}`;
        statements.push(
          `INSERT INTO benchmark_runs(public_id, contributor_key, published_at, visibility, detail, is_synthetic) VALUES (${quote(id)}, ${quote(contributor)}, '2026-09-26T12:00:00Z', 'published', ${quote(JSON.stringify(detail))}, 1) ON CONFLICT(public_id) DO NOTHING;`,
        );
      }
    }
  }

  return statements;
}
