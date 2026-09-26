import { syntheticHardware } from './fixture-hardware';

import type { StoredRun } from './stored-run';
export { syntheticHardware } from './fixture-hardware';
export type { StoredRun } from './stored-run';

// Keep existing seed measurements independent of the supported map catalog.
const syntheticMaps = [
  { id: 'lighthouse', name: 'Lighthouse' },
  { id: 'customs', name: 'Customs' },
  { id: 'streets', name: 'Streets of Tarkov' },
  { id: 'woods', name: 'Woods' },
];

const ids = [
  '8N4qP2vK',
  '3tQ7mW5a',
  '6pD2sJ9n',
  '5vR8hC1x',
  '9jF3bT6z',
  '2dA7kL4u',
  '7mB1wQ8e',
  '4cS9rV2y',
];

export function createSyntheticRuns(): StoredRun[] {
  return syntheticHardware.flatMap((hardware, groupIndex) =>
    ids.map((id, index) => {
      const map = syntheticMaps[index % syntheticMaps.length];

      if (!map) {
        throw new Error('Missing synthetic map.');
      }

      const average = 120 - groupIndex * 20 - index * 3;
      const resolution =
        index === 1 ? { width: 1920, height: 1080 } : { width: 2560, height: 1440 };
      const version = index === 3 ? '0.16.8.0' : '0.16.9.0';

      return {
        contributor: `fictional-contributor-${groupIndex}-${index % 2}`,
        publishedAt: `2026-09-20T10:0${index}:00Z`,
        detail: {
          public_run_id: `br_${id}${['a', 'b', 'c'].at(groupIndex) ?? 'x'}`,
          url: `/bench/runs/br_${id}${['a', 'b', 'c'].at(groupIndex) ?? 'x'}`,
          captured_day: `2026-09-${String(19 - Math.floor(index / 2)).padStart(2, '0')}`,
          hardware: { ...hardware, tuning_class: index % 2 === 0 ? 'unknown' : 'undervolted' },
          conditions: {
            map,
            execution: index === 1 || index === 3 ? 'local' : 'bsg_servers',
            game_resolution: index === 7 ? null : resolution,
            game_version: index === 6 ? null : version,
            render_scale: null,
            upscaling: null,
            weather: 'unknown',
            time_of_day: 'day',
          },
          capture: { duration_sec: 120, sample_count: average * 120 },
          metrics: {
            average_fps: average,
            one_percent_low_fps: average * 0.7,
            zero_point_one_percent_low_fps: average * 0.5,
            average_frametime_ms: 1000 / average,
            p95_frametime_ms: 1500 / average,
            p99_frametime_ms: 2000 / average,
          },
          settings:
            index === 7
              ? null
              : {
                  game: { automatic_ram_cleaner: false, only_use_physical_cores: true },
                  graphics: {
                    screen_mode: 'borderless',
                    texture_quality_code: index % 3,
                    shadows_quality_code: 0,
                    anti_aliasing: 'TAA_High',
                    dlss_mode: index === 4 ? 'Quality' : 'Off',
                    vsync: false,
                  },
                  postfx: { enabled: index === 2 },
                },
          quality_notes: [],
          author: null,
        },
      };
    }),
  );
}
