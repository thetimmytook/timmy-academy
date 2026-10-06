import { describe, expect, it } from 'vitest';

import {
  createMissingResourceTelemetryFixture,
  createResourceTelemetryFixture,
} from './resource-telemetry.fixture';
import { settingsSnapshotSchema } from './settings-snapshot';
import { submissionRequestSchema } from './submission';

const settings = {
  schema_version: 1,
  game: { AutoEmptyWorkingSet: false, SetAffinityToLogicalCores: true },
  graphics: {
    DisplaySettings: { FullScreenMode: 1, Resolution: { Width: 2560, Height: 1440 } },
    TextureQuality: 2,
    ShadowsQuality: 0,
    LodBias: 2.5,
    OverallVisibility: 1000,
    CloudsQuality: 'Low',
    AntiAliasing: 'TAA_High',
    VolumetricLight: 'Low',
    DLSSMode: 'Off',
    DLSSPreset: 'Default',
    FSR2Mode: 'Off',
    FSR3Mode: 'Off',
    SuperSampling: 'Off',
    SuperSamplingFactor: 1,
    Ssao: 'FastestPerformance',
    SSR: 'Off',
    AnisotropicFiltering: 'ForceEnable',
    NVidiaReflex: 'On',
    Sharpen: 0.6,
    VSync: false,
    DisableGameFramerateLimit: false,
    LobbyFramerate: 120,
    GameFramerate: 120,
    HighQualityColor: false,
    ZBlur: false,
    AreaLightsInstancing: false,
    ChromaticAberrations: false,
    Noise: false,
    GrassShadow: false,
    SdTarkovStreets: false,
  },
  postfx: { EnablePostFx: false },
};
const request = {
  schema_version: 1,
  client_run_id: '0ac1d9d2-4c89-4cda-a399-c5134cd7e948',
  captured_day: '2026-09-16',

  // Four-part application version from the documented DTO, not a network address.
  // eslint-disable-next-line sonarjs/no-hardcoded-ip
  app_version: '1.0.3.0',
  hardware: {
    cpu_name: 'Ryzen 7 7800X3D',
    gpu_name: 'GeForce RTX 4070 SUPER',
    ram_gb: 32,
    tuning_class: 'unknown',
  },
  map: 'lighthouse',
  execution: 'bsg_servers',
  game_resolution: { width: 2560, height: 1440 },
  game_version: '0.16.9.0',
  context: { weather: 'unknown', time_of_day: 'day' },
  settings_snapshot: settings,
  capture: { duration_sec: 118.7, sample_count: 14363 },
  resource_telemetry: createMissingResourceTelemetryFixture('not_collected'),
  metrics: {
    average_fps: 121,
    one_percent_low_fps: 82,
    zero_point_one_percent_low_fps: 54,
    average_frametime_ms: 8.26,
    p95_frametime_ms: 11.8,
    p99_frametime_ms: 16.4,
  },
};

describe('submission transport contract', () => {
  it('requires the explicit telemetry block in schema version 1', () => {
    expect(
      submissionRequestSchema.safeParse({ ...request, resource_telemetry: undefined }).success,
    ).toBe(false);
    expect(
      submissionRequestSchema.safeParse({ ...request, resource_telemetry: null }).success,
    ).toBe(false);
  });
  it.each(['unavailable', 'not_collected'] as const)(
    'accepts explicit %s telemetry without inventing measurements',
    status => {
      const input = {
        ...request,
        resource_telemetry: createMissingResourceTelemetryFixture(status),
      };
      expect(submissionRequestSchema.parse(input)).toEqual(input);
    },
  );
  it('bounds the telemetry interval union by accepted FPS intervals and rounding', () => {
    const input = {
      ...request,
      capture: { duration_sec: 120.0005, sample_count: 12000 },
      metrics: { ...request.metrics, average_fps: 100, average_frametime_ms: 10 },
      resource_telemetry: createResourceTelemetryFixture(),
    };
    expect(submissionRequestSchema.parse(input)).toEqual(input);
    expect(
      submissionRequestSchema.safeParse({
        ...input,
        resource_telemetry: createResourceTelemetryFixture(120.013),
      }).success,
    ).toBe(false);
  });
  it.each([119.995, 120.006])(
    'accepts Core interval overlap or merged micro-gaps: %s seconds',
    duration => {
      const input = {
        ...request,
        capture: { duration_sec: 120, sample_count: 12000 },
        metrics: { ...request.metrics, average_fps: 100, average_frametime_ms: 10 },
        resource_telemetry: createResourceTelemetryFixture(duration),
      };
      expect(submissionRequestSchema.parse(input)).toEqual(input);
    },
  );
  it('accepts selected settings without rewriting measured values or false toggles', () => {
    expect(submissionRequestSchema.parse(request)).toEqual(request);
  });
  it('accepts unknown resolution, version and settings without inventing defaults', () => {
    const unknowns = {
      ...request,
      settings_snapshot: null,
      game_resolution: null,
      game_version: null,
    };
    expect(submissionRequestSchema.parse(unknowns)).toEqual(unknowns);
    expect(
      settingsSnapshotSchema.parse({ schema_version: 1, game: { AutoEmptyWorkingSet: false } }),
    ).toEqual({ schema_version: 1, game: { AutoEmptyWorkingSet: false } });
  });
  it('accepts the actual capture minimum of 110 seconds and 120 samples', () => {
    expect(
      submissionRequestSchema.safeParse({
        ...request,
        capture: { duration_sec: 110, sample_count: 120 },
        metrics: {
          average_fps: 1.09,
          one_percent_low_fps: 1,
          zero_point_one_percent_low_fps: 0.9,
          average_frametime_ms: 916.667,
          p95_frametime_ms: 1000,
          p99_frametime_ms: 1100,
        },
      }).success,
    ).toBe(true);
  });
  it.each([
    { duration_sec: 109.99, sample_count: 120 },
    { duration_sec: 120, sample_count: 119 },
    { duration_sec: 120, sample_count: 120.5 },
    { duration_sec: Infinity, sample_count: 120 },
    { duration_sec: 120, sample_count: 120, valid: true },
  ])('rejects incomplete or malformed measured captures: %j', capture => {
    expect(submissionRequestSchema.safeParse({ ...request, capture }).success).toBe(false);
  });
  it.each([
    { accountId: 'private' },
    { email: 'private' },
    { public_run_id: 'br_client' },
    { raw_csv: 'private' },
    { path: 'private' },
    { warnings: [] },
    { hardware: { ...request.hardware, serial_number: 'private' } },
    { context: { ...request.context, comment: 'private' } },
    { metrics: { ...request.metrics, frames: [] } },
    { schema_version: 2 },
    { client_run_id: 'invalid' },
    { hardware: { ...request.hardware, ram_gb: 0 } },
    { metrics: { ...request.metrics, average_fps: NaN } },
  ])('rejects invalid values and extra fields: %j', overrides => {
    expect(submissionRequestSchema.safeParse({ ...request, ...overrides }).success).toBe(false);
  });
  it.each([null, { width: 1920, height: 1080 }])(
    'rejects resolution conflicting with captured settings: %j',
    game_resolution => {
      expect(submissionRequestSchema.safeParse({ ...request, game_resolution }).success).toBe(
        false,
      );
    },
  );
});

describe('selected settings allowlist', () => {
  it.each([
    { schema_version: 2, game: { AutoEmptyWorkingSet: false } },
    { schema_version: 1 },
    { schema_version: 1, game: {} },
    { schema_version: 1, graphics: { DisplaySettings: {} } },
    { schema_version: 1, postfx: { Brightness: 0 } },
    { schema_version: 1, graphics: { Stored: [] } },
    { schema_version: 1, graphics: { DisplaySettings: { Display: 0 } } },
    { schema_version: 1, graphics: { DisplaySettings: { Resolution: { Width: 2560 } } } },
    { schema_version: 1, graphics: { DisplaySettings: { FullScreenMode: 3 } } },
    { schema_version: 1, game: { AutoEmptyWorkingSet: 'false' } },
    { schema_version: 1, graphics: { TextureQuality: 16 } },
    { schema_version: 1, graphics: { DLSSMode: 'some free text' } },
    { schema_version: 1, graphics: { DLSSMode: 'C:/private' } },
    { schema_version: 1, graphics: { LodBias: 11 } },
    { schema_version: 1, graphics: { SuperSamplingFactor: 0 } },
    { schema_version: 1, graphics: { GameFramerate: 1001 } },
  ])('rejects unreviewed keys, empty sections and values outside bounds: %j', input => {
    expect(settingsSnapshotSchema.safeParse(input).success).toBe(false);
  });
});

describe('submission metric consistency', () => {
  it.each([
    { average_fps: 150 },
    { average_frametime_ms: 12 },
    { one_percent_low_fps: 130 },
    { zero_point_one_percent_low_fps: 90 },
    { p95_frametime_ms: 20 },
  ])('rejects inconsistent measurements without rewriting them: %j', overrides => {
    const input = { ...request, metrics: { ...request.metrics, ...overrides } };
    const before = JSON.stringify(input);
    expect(submissionRequestSchema.safeParse(input).success).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('rejects a requested duration substituted for measured duration', () => {
    expect(
      submissionRequestSchema.safeParse({
        ...request,
        capture: { ...request.capture, duration_sec: 120 },
      }).success,
    ).toBe(false);
  });
  it('rejects an unrelated frame count', () => {
    expect(
      submissionRequestSchema.safeParse({
        ...request,
        capture: { ...request.capture, sample_count: 20000 },
      }).success,
    ).toBe(false);
  });
  it('accepts independently rounded values at the supported precision', () => {
    const input = {
      ...request,
      capture: { duration_sec: 120.001, sample_count: 14400 },
      metrics: { ...request.metrics, average_fps: 120, average_frametime_ms: 8.33 },
    };
    expect(submissionRequestSchema.parse(input)).toEqual(input);
  });
  it('accepts mean frametime above P95 when rare long frames raise the average', () => {
    // 11,999 frames at 8 ms plus one at 24,000 ms; same formulas as the collector.
    const input = {
      ...request,
      capture: { duration_sec: 119.992, sample_count: 12000 },
      metrics: {
        average_fps: 100.01,
        average_frametime_ms: 9.999,
        one_percent_low_fps: 4.81,
        zero_point_one_percent_low_fps: 0.5,
        p95_frametime_ms: 8,
        p99_frametime_ms: 8,
      },
    };
    expect(submissionRequestSchema.parse(input)).toEqual(input);
  });
  it('accepts equal lows and percentiles for an even capture', () => {
    expect(
      submissionRequestSchema.safeParse({
        ...request,
        capture: { duration_sec: 120, sample_count: 12000 },
        metrics: {
          average_fps: 100,
          one_percent_low_fps: 100,
          zero_point_one_percent_low_fps: 100,
          average_frametime_ms: 10,
          p95_frametime_ms: 10,
          p99_frametime_ms: 10,
        },
      }).success,
    ).toBe(true);
  });
});
