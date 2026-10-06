import { namedModelSchema, publicRunDetailSchema, submissionRequestSchema } from '@timmy/contracts';
import { describe, expect, it } from 'vitest';

import { createSyntheticRuns } from './fixtures';
import { normalizeHardware } from './hardware-normalization';
import { normalizeSubmission } from './submission-normalization';

const hardware = { cpu_name: 'New CPU 123', gpu_name: 'New GPU 456', ram_gb: 32 };

describe('hardware normalization', () => {
  it('uses the same name-derived IDs for familiar models', async () => {
    expect(
      await normalizeHardware({
        cpu_name: '  RYZEN  7 7800x3d ',
        gpu_name: 'geforce RTX 4070 SUPER',
        ram_gb: 32,
      }),
    ).toEqual({
      cpu: {
        id: 'cpu-ac225bb136f5c3f6681e28a53b3195f986b04815d2961852b3ba5f1a29e122d1',
        name: 'RYZEN 7 7800x3d',
      },
      gpu: {
        id: 'gpu-6bfdb94a69337e5c975508bac8b078a90c2627bcfe52aa29b97980c9b9cd4bea',
        name: 'geforce RTX 4070 SUPER',
      },
      ram_gb: 32,
    });
  });
  it('assigns stable new IDs without losing display spelling', async () => {
    const first = await normalizeHardware(hardware);
    const second = await normalizeHardware({
      cpu_name: ' NEW  cpu\t123 ',
      gpu_name: 'new GPU 456 ',
      ram_gb: 64,
    });
    expect(first.cpu.id).toBe(second.cpu.id);
    expect(first.gpu.id).toBe(second.gpu.id);
    expect(first.cpu.name).toBe('New CPU 123');
    expect(second.cpu.name).toBe('NEW cpu 123');
    expect(second.ram_gb).toBe(64);
    expect(namedModelSchema.parse(first.cpu)).toEqual(first.cpu);
  });
  it.each(['Ti', 'SUPER', 'Laptop', 'F', 'X3D'])(
    'does not discard the model suffix %s',
    async suffix => {
      const base = await normalizeHardware(hardware);
      const variant = await normalizeHardware({
        ...hardware,
        cpu_name: hardware.cpu_name + ' ' + suffix,
        gpu_name: hardware.gpu_name + ' ' + suffix,
      });
      expect(variant.cpu.id).not.toBe(base.cpu.id);
      expect(variant.gpu.id).not.toBe(base.gpu.id);
    },
  );
  it('does not collapse punctuation as slug-based IDs would', async () => {
    const first = await normalizeHardware({ ...hardware, cpu_name: 'Model A-B' });
    const second = await normalizeHardware({ ...hardware, cpu_name: 'Model A B' });
    expect(first.cpu.id).not.toBe(second.cpu.id);
  });
  it('rejects a whitespace-only model name', async () => {
    await expect(normalizeHardware({ ...hardware, cpu_name: ' \t ' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});

describe('submission normalization', () => {
  it('uses the same hardware IDs as Position input and excludes intake metadata', async () => {
    const request = submissionRequestSchema.parse({
      schema_version: 1,
      client_run_id: '00000000-0000-4000-8000-000000000001',
      captured_day: '2026-09-25',
      app_version: '1.0.0',
      hardware: { ...hardware, tuning_class: 'stock' },
      map: 'lighthouse',
      execution: 'local',
      game_resolution: null,
      game_version: null,
      context: { weather: 'unknown', time_of_day: 'day' },
      settings_snapshot: { schema_version: 1, game: { AutoEmptyWorkingSet: false } },
      capture: { duration_sec: 120, sample_count: 12000 },
      resource_telemetry: createSyntheticRuns()[0]!.detail.resource_telemetry,
      metrics: {
        average_fps: 100,
        one_percent_low_fps: 100,
        zero_point_one_percent_low_fps: 100,
        average_frametime_ms: 10,
        p95_frametime_ms: 10,
        p99_frametime_ms: 10,
      },
    });
    const result = await normalizeSubmission(request);
    expect(result.hardware).toEqual({
      ...(await normalizeHardware(hardware)),
      tuning_class: 'stock',
    });
    expect(result.settings).toEqual({ game: { automatic_ram_cleaner: false } });
    expect(result.metrics).toEqual(request.metrics);
    expect(result.resource_telemetry).toEqual(request.resource_telemetry);
    expect(result.author).toBeNull();
    expect(result.quality_notes).toEqual([]);
    expect(result.conditions).toMatchObject({
      render_scale: null,
      upscaling: null,
      game_resolution: null,
    });
    expect(
      publicRunDetailSchema
        .omit({ public_run_id: true, url: true, is_synthetic: true })
        .parse(result),
    ).toEqual(result);

    for (const key of ['app_version', 'client_run_id', 'schema_version', 'settings_snapshot']) {
      expect(result).not.toHaveProperty(key);
    }
  });
});
