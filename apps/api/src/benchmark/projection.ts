import {
  hardwareSchema,
  publicRunDetailSchema,
  publicRunSummarySchema,
  publicSettingsSchema,
  type PublicRunDetail,
  type PublicRunSummary,
  type PublicSettings,
} from '@timmy/contracts';

import type { StoredRun } from './stored-run';

function definedFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export function projectPublicSettings(settings: PublicSettings | null): PublicSettings | null {
  if (settings === null) return null;
  const game = definedFields({
    automatic_ram_cleaner: settings.game?.automatic_ram_cleaner,
    only_use_physical_cores: settings.game?.only_use_physical_cores,
  });
  const graphics = definedFields({
    screen_mode: settings.graphics?.screen_mode,
    texture_quality_code: settings.graphics?.texture_quality_code,
    shadows_quality_code: settings.graphics?.shadows_quality_code,
    object_lod: settings.graphics?.object_lod,
    overall_visibility: settings.graphics?.overall_visibility,
    clouds_quality: settings.graphics?.clouds_quality,
    anti_aliasing: settings.graphics?.anti_aliasing,
    volumetric_lighting: settings.graphics?.volumetric_lighting,
    dlss_mode: settings.graphics?.dlss_mode,
    dlss_preset: settings.graphics?.dlss_preset,
    fsr2_mode: settings.graphics?.fsr2_mode,
    fsr3_mode: settings.graphics?.fsr3_mode,
    resampling_mode: settings.graphics?.resampling_mode,
    resampling_factor: settings.graphics?.resampling_factor,
    hbao: settings.graphics?.hbao,
    ssr: settings.graphics?.ssr,
    anisotropic_filtering: settings.graphics?.anisotropic_filtering,
    nvidia_reflex: settings.graphics?.nvidia_reflex,
    sharpness: settings.graphics?.sharpness,
    vsync: settings.graphics?.vsync,
    disable_game_fps_limit: settings.graphics?.disable_game_fps_limit,
    lobby_fps_limit: settings.graphics?.lobby_fps_limit,
    game_fps_limit: settings.graphics?.game_fps_limit,
    high_quality_color: settings.graphics?.high_quality_color,
    z_blur: settings.graphics?.z_blur,
    area_light_instancing: settings.graphics?.area_light_instancing,
    chromatic_aberrations: settings.graphics?.chromatic_aberrations,
    noise: settings.graphics?.noise,
    grass_shadows: settings.graphics?.grass_shadows,
    streets_lower_texture_resolution: settings.graphics?.streets_lower_texture_resolution,
  });
  const postfx = definedFields({ enabled: settings.postfx?.enabled });
  const projection = {
    ...(Object.keys(game).length > 0 ? { game } : {}),
    ...(Object.keys(graphics).length > 0 ? { graphics } : {}),
    ...(Object.keys(postfx).length > 0 ? { postfx } : {}),
  };
  return Object.keys(projection).length === 0 ? null : publicSettingsSchema.parse(projection);
}

export function projectHardware(run: StoredRun) {
  const { cpu, gpu, ram_gb } = run.detail.hardware;
  return hardwareSchema.parse({
    cpu: { id: cpu.id, name: cpu.name },
    gpu: { id: gpu.id, name: gpu.name },
    ram_gb,
  });
}

export function projectSummary(run: StoredRun): PublicRunSummary {
  const detail = run.detail;
  const { map, execution, game_resolution, game_version } = detail.conditions;
  return publicRunSummarySchema.parse({
    public_run_id: detail.public_run_id,
    url: `/bench/runs/${detail.public_run_id}`,
    captured_day: detail.captured_day,
    map: { id: map.id, name: map.name },
    execution,
    game_resolution:
      game_resolution === null
        ? null
        : { width: game_resolution.width, height: game_resolution.height },
    game_version,
    metrics: {
      average_fps: detail.metrics.average_fps,
      one_percent_low_fps: detail.metrics.one_percent_low_fps,
    },
  });
}

export function projectDetail(run: StoredRun): PublicRunDetail {
  const detail = run.detail;
  const summary = projectSummary(run);
  // Select public fields before validation; private additions never enter the DTO.
  return publicRunDetailSchema.parse({
    public_run_id: summary.public_run_id,
    url: summary.url,
    captured_day: summary.captured_day,
    hardware: {
      ...projectHardware(run),
      ...(detail.hardware.tuning_class === undefined
        ? {}
        : { tuning_class: detail.hardware.tuning_class }),
    },
    conditions: {
      map: summary.map,
      execution: summary.execution,
      game_resolution: summary.game_resolution,
      game_version: summary.game_version,
      render_scale: null,
      upscaling: null,
      weather: detail.conditions.weather,
      time_of_day: detail.conditions.time_of_day,
    },
    capture: {
      duration_sec: detail.capture.duration_sec,
      sample_count: detail.capture.sample_count,
    },
    metrics: {
      ...summary.metrics,
      zero_point_one_percent_low_fps: detail.metrics.zero_point_one_percent_low_fps,
      average_frametime_ms: detail.metrics.average_frametime_ms,
      p95_frametime_ms: detail.metrics.p95_frametime_ms,
      p99_frametime_ms: detail.metrics.p99_frametime_ms,
    },
    settings: projectPublicSettings(detail.settings),
    quality_notes: detail.quality_notes,
    author:
      detail.author === null
        ? null
        : { display_name: detail.author.display_name, avatar_url: detail.author.avatar_url },
  });
}
