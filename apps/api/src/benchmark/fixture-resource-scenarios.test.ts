import { publicRunDetailSchema, resourceTelemetrySchema } from '@timmy/contracts';
import { describe, expect, it } from 'vitest';

import { syntheticHardware, syntheticUmaHardware } from './fixture-hardware';
import { createResourceScenario, resourceScenarios } from './fixture-resource-scenarios';
import { createSyntheticRuns } from './fixtures';
import { normalizeHardware } from './hardware-normalization';

const gib = 2 ** 30;
const hardware = syntheticHardware[0]!;

describe('synthetic resource scenarios', () => {
  it.each(resourceScenarios)(
    'produces a strict, consistent %s capture for every discrete fixture',
    scenario => {
      for (const profile of syntheticHardware) {
        const telemetry = resourceTelemetrySchema.parse(createResourceScenario(profile, scenario));
        expect(telemetry.gpu.adapter_name).toBe(profile.gpu.name);
        expect(telemetry.ram.installed_capacity.value).toBe(profile.ram_gb * gib);
        expect(telemetry.gpu.dedicated_vram_capacity.value).toBe(
          (profile.gpu.name === 'GeForce RTX 3060 Ti' ? 8 : 12) * gib,
        );
        expect(telemetry.window.duration_sec).toBe(120);

        if (scenario !== 'unavailable') {
          expect(
            telemetry.ram.physical_used.average! + telemetry.ram.physical_available.average!,
          ).toBe(telemetry.ram.os_usable_capacity.value);
          expect(telemetry.commit.used.average! + telemetry.commit.headroom.average!).toBe(
            telemetry.commit.limit.average,
          );
          expect(telemetry.commit.used.last! + telemetry.commit.headroom.last!).toBe(
            telemetry.commit.limit.last,
          );
        }
      }
    },
  );

  it('matches total CPU averages to the measured logical processors and hardware profiles', () => {
    for (const profile of syntheticHardware) {
      const telemetry = createResourceScenario(profile, 'normal');
      const processors = telemetry.cpu.logical_processors;
      expect(processors).toHaveLength(profile.cpu.name === 'Core i5-12400F' ? 12 : 16);
      expect(
        processors.reduce((sum, processor) => sum + processor.utilization.average!, 0) /
          processors.length,
      ).toBe(telemetry.cpu.total_utilization.average);
      expect(telemetry.ram.physical_available.minimum).toBeGreaterThan(2 * gib);
      expect(telemetry.commit.headroom.minimum).toBeGreaterThan(2 * gib);
      expect(telemetry.gpu.dedicated_memory_used.maximum).toBeLessThan(
        telemetry.gpu.dedicated_vram_capacity.value! * 0.95,
      );
    }
  });

  it('keeps pressure examples independent from collection status and hardware capacity', () => {
    const vram = createResourceScenario(hardware, 'near_full_vram');
    expect(vram.status).toBe('available');
    expect(vram.gpu.dedicated_memory_used.maximum).toBeGreaterThan(
      vram.gpu.dedicated_vram_capacity.value! * 0.95,
    );
    expect(vram.gpu.dedicated_memory_used.maximum).toBeLessThan(
      vram.gpu.dedicated_vram_capacity.value!,
    );
    expect(
      createResourceScenario(hardware, 'low_available_ram').ram.physical_available.minimum,
    ).toBe(gib / 8);
    expect(createResourceScenario(hardware, 'low_commit_headroom').commit.headroom.minimum).toBe(
      gib / 8,
    );
  });

  it('distinguishes partial support and unknown policy from unavailable measurements', () => {
    const telemetry = createResourceScenario(hardware, 'partial');
    expect(telemetry.cpu.total_utilization.coverage).toBe(0.75);
    expect(telemetry.cpu.total_utilization.valid_sample_count).toBe(90);
    expect(telemetry.cpu.total_utilization.valid_duration_sec).toBe(90);
    expect(telemetry.cpu.total_utilization.average).toBeGreaterThan(0);
    expect(telemetry.gpu.graphics_utilization.average).toBeNull();
    expect(telemetry.pagefile.automatic_management).toBeNull();
    expect(telemetry.gpu.dedicated_vram_capacity.value).toBe(12 * gib);
    const unavailable = createResourceScenario(hardware, 'unavailable');
    expect(unavailable.cpu.total_utilization.average).toBeNull();
    expect(unavailable.cpu.total_utilization.valid_sample_count).toBe(0);
    expect(unavailable.commit.headroom.minimum).toBeNull();
  });

  it('models a second pagefile appearing mid-capture and a growing commit limit', () => {
    const telemetry = createResourceScenario(hardware, 'multiple_pagefiles');
    const files = telemetry.pagefile.files;
    expect(files.map(file => [file.index, file.drive_media_type])).toEqual([
      [1, 'SSD'],
      [2, 'HDD'],
    ]);
    expect(files[1]!.allocated.coverage).toBe(0.5);
    expect(files[1]!.allocated.valid_duration_sec).toBe(60);
    expect(telemetry.pagefile.file_count.average).toBe(1.5);
    expect(telemetry.pagefile.allocated.average).toBe(
      files[0]!.allocated.average! + files[1]!.allocated.average! * files[1]!.allocated.coverage,
    );
    expect(telemetry.pagefile.used.average).toBe(
      files[0]!.used.average! + files[1]!.used.average! * files[1]!.used.coverage,
    );
    expect(telemetry.commit.limit.maximum! - telemetry.commit.limit.minimum!).toBe(8 * gib);
    expect(telemetry.pagefile.allocated.maximum! - telemetry.pagefile.allocated.minimum!).toBe(
      8 * gib,
    );
  });

  it('adds a real model pair for UMA while keeping zero physical VRAM distinct from usage', async () => {
    expect(
      await normalizeHardware({
        cpu_name: syntheticUmaHardware.cpu.name,
        gpu_name: syntheticUmaHardware.gpu.name,
        ram_gb: syntheticUmaHardware.ram_gb,
      }),
    ).toEqual(syntheticUmaHardware);
    const telemetry = resourceTelemetrySchema.parse(
      createResourceScenario(syntheticUmaHardware, 'uma'),
    );
    expect(telemetry.gpu.memory_architecture).toBe('unified');
    expect(telemetry.gpu.graphics_utilization.source).toBe('adlx_gpu_usage');
    expect(telemetry.gpu.dedicated_memory_used.source).toBe('pdh_gpu_adapter_memory_dedicated');
    expect(telemetry.gpu.shared_memory_used.source).toBe('pdh_gpu_adapter_memory_shared');
    expect(telemetry.gpu.dedicated_vram_capacity.value).toBe(0);
    expect(telemetry.gpu.shared_memory_used.maximum).toBe(3 * gib);
    expect(telemetry.ram.os_usable_capacity.value).toBe(28 * gib);
  });

  it('keeps all 24 standard fixtures valid and most captures ordinary', () => {
    const runs = createSyntheticRuns().map(run => publicRunDetailSchema.parse(run.detail));
    expect(runs).toHaveLength(24);
    expect(runs.every(run => run.is_synthetic)).toBe(true);
    expect(runs.filter(run => run.resource_telemetry.status === 'available')).toHaveLength(22);
    expect(runs.filter(run => run.resource_telemetry.pagefile.files.length > 1)).toHaveLength(1);
    expect(
      runs.filter(
        run =>
          run.resource_telemetry.gpu.graphics_utilization.source ===
          'nvapi_gpu_graphics_utilization',
      ),
    ).toHaveLength(1);
    expect(
      runs.filter(
        run =>
          run.resource_telemetry.gpu.graphics_utilization.source ===
          'pdh_gpu_engine_3d_busiest_engine',
      ),
    ).toHaveLength(23);
  });
});
