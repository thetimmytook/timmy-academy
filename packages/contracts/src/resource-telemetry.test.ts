import { describe, expect, expectTypeOf, it } from 'vitest';

import { MAX_LOGICAL_PROCESSORS, MAX_PAGEFILES } from './limits';
import { resourceTelemetrySchema } from './resource-telemetry';
import {
  createResourceTelemetryFixture as fixture,
  createMissingResourceTelemetryFixture as missingTelemetry,
  createUnavailableMetricFixture as unavailable,
} from './resource-telemetry.fixture';

import type {
  GraphicsUtilizationSource,
  ResourceTelemetry,
  ResourceTelemetrySummary,
} from './resource-telemetry';

const gib = 2 ** 30;

function partial(data: ResourceTelemetry, duration = 119.4, coverage = 0.995): void {
  data.status = 'partial';
  data.cpu.total_utilization = {
    ...data.cpu.total_utilization,
    valid_duration_sec: duration,
    coverage,
    status: 'partial',
    reason_codes: ['partial_coverage'],
  };
  data.warnings = ['partial_coverage'];
}

describe('capture-window telemetry contract', () => {
  it('keeps the graphics source a closed literal union in full and owner contracts', () => {
    expectTypeOf<GraphicsUtilizationSource>().toEqualTypeOf<
      'pdh_gpu_engine_3d_busiest_engine' | 'nvapi_gpu_graphics_utilization' | 'adlx_gpu_usage'
    >();
    expectTypeOf<
      ResourceTelemetrySummary['gpu']['graphics_utilization']['source']
    >().toEqualTypeOf<GraphicsUtilizationSource>();
  });
  it.each([
    'pdh_gpu_engine_3d_busiest_engine',
    'nvapi_gpu_graphics_utilization',
    'adlx_gpu_usage',
  ] as const)('retains %s through measured, partial and unavailable summaries', source => {
    const data = fixture(120, source);
    expect(resourceTelemetrySchema.parse(data)).toEqual(data);
    Object.assign(data.gpu.graphics_utilization, {
      status: 'partial',
      coverage: 0.75,
      valid_duration_sec: 90,
      valid_sample_count: 90,
      reason_codes: ['partial_coverage'],
    });
    data.status = 'partial';
    data.warnings = ['partial_coverage'];
    expect(resourceTelemetrySchema.parse(data)).toEqual(data);
    data.gpu.graphics_utilization = unavailable(
      data.gpu.graphics_utilization,
      'collector_unavailable',
    );
    data.warnings = ['collector_unavailable'];
    expect(resourceTelemetrySchema.parse(data)).toEqual(data);

    for (const status of ['unavailable', 'not_collected'] as const) {
      const missing = missingTelemetry(status);
      missing.gpu.graphics_utilization.source = source;
      expect(resourceTelemetrySchema.parse(missing)).toEqual(missing);
    }
  });

  it.each([
    'pdh_gpu_engine_3d_busiest_engine',
    'nvapi_gpu_graphics_utilization',
    'adlx_gpu_usage',
  ] as const)('keeps %s statistics, scope, unit and privacy constraints strict', source => {
    for (const overrides of [
      { source: 'unknown_gpu_utilization' },
      { source: null },
      { unit: 'bytes' },
      { scope: 'process' },
      { maximum: 101 },
      { average: null },
      { minimum: -1 },
      { last: 101 },
      { valid_sample_count: 10001 },
      { valid_duration_sec: 121 },
      { coverage: 1.1 },
      { status: 'partial' },
      { reason_codes: ['native_error'] },
      { raw_samples: [85] },
      { pid: 123 },
      { application_name: 'private' },
      { path: 'private' },
      { device_id: 'private' },
    ]) {
      const data = fixture(120, source);
      Object.assign(data.gpu.graphics_utilization, overrides);
      expect(resourceTelemetrySchema.safeParse(data).success).toBe(false);
    }

    const data = fixture(120, source);
    data.gpu.graphics_utilization.valid_sample_count = 80;

    // Existing PDH interval support remains 1.5 s; vendor gauges retain the 1 s cap.
    expect(resourceTelemetrySchema.safeParse(data).success).toBe(source.startsWith('pdh_'));
    data.gpu.graphics_utilization.valid_sample_count = 120;
    Object.assign(data.gpu.dedicated_memory_used, { source });
    expect(resourceTelemetrySchema.safeParse(data).success).toBe(false);
  });

  it('retains all supported C# summary fields, units, scopes, sources and explicit nulls', () => {
    for (const data of [
      fixture(),
      missingTelemetry('unavailable'),
      missingTelemetry('not_collected'),
    ]) {
      expect(resourceTelemetrySchema.parse(data)).toEqual(data);
    }

    expect(resourceTelemetrySchema.safeParse(null).success).toBe(false);
    expect(resourceTelemetrySchema.safeParse({ status: 'not_collected' }).success).toBe(false);
  });

  it('accepts ordinary partial coverage, and independently rounded coverage/duration', () => {
    const data = fixture();
    partial(data, 118.765432, 0.989712);
    expect(resourceTelemetrySchema.parse(data)).toEqual(data);
    partial(data, 119.99988, 0.999999);
    expect(resourceTelemetrySchema.safeParse(data).success).toBe(true);
    data.cpu.total_utilization.status = 'available';
    data.cpu.total_utilization.reason_codes = [];
    data.status = 'available';
    data.warnings = [];
    expect(resourceTelemetrySchema.safeParse(data).success).toBe(true);
  });

  it('keeps warning codes consistent with unavailable and not-collected sections', () => {
    for (const status of ['unavailable', 'not_collected'] as const) {
      const data = missingTelemetry(status);
      data.warnings.push('summary_unavailable');
      expect(resourceTelemetrySchema.safeParse(data).success).toBe(false);
    }

    const measured = fixture();
    measured.warnings = ['collector_unavailable'];
    expect(resourceTelemetrySchema.safeParse(measured).success).toBe(false);
  });

  it('accepts tiny measured support rounded to zero, rather than treating it as unavailable', () => {
    const data = fixture();
    partial(data, 0, 0);
    data.cpu.total_utilization.valid_sample_count = 1;
    expect(resourceTelemetrySchema.safeParse(data).success).toBe(true);
  });

  it('distinguishes measured zero pagefiles from failed enumeration', () => {
    const data = fixture();
    data.pagefile.files = [];

    for (const metric of [data.pagefile.file_count, data.pagefile.allocated, data.pagefile.used]) {
      Object.assign(metric, { average: 0, minimum: 0, maximum: 0, last: 0 });
    }

    expect(resourceTelemetrySchema.parse(data)).toEqual(data);
    const missing = missingTelemetry('unavailable');
    expect(resourceTelemetrySchema.parse(missing).pagefile.used.average).toBeNull();
  });

  it('accepts growing pagefiles, fractional weighted file counts and changing commit limits', () => {
    const data = fixture();
    data.pagefile.file_count = {
      ...data.pagefile.file_count,
      average: 1.5,
      minimum: 1,
      maximum: 2,
      last: 2,
    };
    data.pagefile.files.push({ ...data.pagefile.files[0]!, index: 2, drive_media_type: 'HDD' });
    data.pagefile.allocated = {
      ...data.pagefile.allocated,
      average: 36 * gib,
      minimum: 24 * gib,
      maximum: 48 * gib,
      last: 48 * gib,
    };
    data.commit.limit = {
      ...data.commit.limit,
      average: 66 * gib,
      minimum: 54 * gib,
      maximum: 78 * gib,
      last: 78 * gib,
    };
    data.commit.headroom = {
      ...data.commit.headroom,
      average: 52 * gib,
      minimum: 40 * gib,
      maximum: 64 * gib,
      last: 64 * gib,
    };
    expect(resourceTelemetrySchema.parse(data)).toEqual(data);
  });

  it('accepts UMA with no physical discrete VRAM and independently measured shared memory', () => {
    const data = fixture();
    data.gpu.adapter_name = 'Radeon 780M';
    data.gpu.memory_architecture = 'unified';
    data.gpu.dedicated_vram_capacity = {
      ...data.gpu.dedicated_vram_capacity,
      value: 0,
      source: 'd3d12_unified_memory_no_discrete_vram',
    };
    expect(resourceTelemetrySchema.parse(data)).toEqual(data);
  });

  it('accepts partial telemetry when the selected adapter or a logical counter is unavailable', () => {
    const data = fixture();
    data.gpu = missingTelemetry('unavailable').gpu;
    data.status = 'partial';
    data.warnings = ['active_adapter_unknown'];
    expect(resourceTelemetrySchema.safeParse(data).success).toBe(true);
    data.cpu.logical_processors[0]!.utilization = unavailable(
      data.cpu.logical_processors[0]!.utilization,
      'collector_unavailable',
    );
    data.warnings.push('collector_unavailable');
    expect(resourceTelemetrySchema.safeParse(data).success).toBe(true);
  });

  it('accepts independent processor groups and bounded large machines', () => {
    const data = fixture();
    const logical = data.cpu.logical_processors[0]!;
    data.cpu.logical_processors = Array.from({ length: MAX_LOGICAL_PROCESSORS }, (_, index) => ({
      ...logical,
      group: Math.floor(index / 64),
      index: index % 64,
    }));
    expect(resourceTelemetrySchema.safeParse(data).success).toBe(true);

    // This fixture contains ASCII only, so character and UTF-8 byte counts agree.
    expect(JSON.stringify(data).length).toBeLessThan(256 * 1024);
    data.cpu.logical_processors.push({ ...logical, group: 8, index: 0 });
    expect(resourceTelemetrySchema.safeParse(data).success).toBe(false);
  });

  it.each(['cpu', 'gpu', 'ram', 'pagefile', 'commit', 'window'] as const)(
    'rejects private additions in %s',
    section => {
      const data = fixture();
      const injected = Object.fromEntries(
        Object.entries(data).map(([key, value]) => [
          key,
          key === section
            ? {
                ...(value as ResourceTelemetry[typeof section]),
                pid: 123,
                path: 'private-path',
                native_error: 'private error',
              }
            : value,
        ]),
      );
      expect(resourceTelemetrySchema.safeParse(injected).success).toBe(false);
    },
  );

  it.each([
    (data: ResourceTelemetry): void => {
      Object.assign(data.cpu.total_utilization, { raw_samples: [] });
    },
    (data: ResourceTelemetry): void => {
      Object.assign(data.cpu.logical_processors[0]!, { process_name: 'other app' });
    },
    (data: ResourceTelemetry): void => {
      Object.assign(data.pagefile.files[0]!, { drive_letter: 'C' });
    },
    (data: ResourceTelemetry): void => {
      Object.assign(data.gpu.dedicated_vram_capacity, { luid: 'private' });
    },
    (data: ResourceTelemetry): void => {
      data.gpu.adapter_name = 'private@example.test';
    },
    (data: ResourceTelemetry): void => {
      data.gpu.adapter_name = 'C:\\private';
    },
    (data: ResourceTelemetry): void => {
      data.gpu.adapter_name = 'd6441fbb-c0af-4db4-9f56-254826da628e';
    },
    (data: ResourceTelemetry): void => {
      Object.assign(data, { warnings: ['native error'] });
    },
  ])('rejects private nested fields, unsafe labels and unreviewed reasons %#', mutate => {
    const data = fixture();
    mutate(data);
    expect(resourceTelemetrySchema.safeParse(data).success).toBe(false);
  });

  it.each([
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.average = Infinity;
    },
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.last = NaN;
    },
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.maximum = 101;
    },
    (data: ResourceTelemetry): void => {
      data.ram.physical_available.minimum = -1;
    },
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.average = 49;
    },
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.last = 51;
    },
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.valid_duration_sec = 121;
    },
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.valid_sample_count = 0;
    },
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.status = 'unavailable';
    },
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.scope = 'whole_adapter';
    },
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.unit = 'bytes';
    },
    (data: ResourceTelemetry): void => {
      Object.assign(data.cpu.total_utilization, { source: 'native error' });
    },
    (data: ResourceTelemetry): void => {
      data.cpu.total_utilization.valid_sample_count = 1;
    },
    (data: ResourceTelemetry): void => {
      data.status = 'not_collected';
    },
    (data: ResourceTelemetry): void => {
      data.window.expected_sample_count = 119;
    },
    (data: ResourceTelemetry): void => {
      data.window.alignment = 'unknown';
    },
    (data: ResourceTelemetry): void => {
      data.gpu.selection_status = 'unknown';
    },
    (data: ResourceTelemetry): void => {
      data.gpu.dedicated_vram_capacity.value = 7 * gib;
    },
    (data: ResourceTelemetry): void => {
      data.gpu.dedicated_vram_capacity.value = 0;
    },
    (data: ResourceTelemetry): void => {
      data.gpu.memory_architecture = 'unknown';
    },
    (data: ResourceTelemetry): void => {
      data.ram.os_usable_capacity.value = 33 * gib;
    },
    (data: ResourceTelemetry): void => {
      data.ram.physical_used.maximum = 32 * gib;
    },
    (data: ResourceTelemetry): void => {
      data.cpu.logical_processors.push(data.cpu.logical_processors[0]!);
    },
    (data: ResourceTelemetry): void => {
      data.pagefile.files.push(data.pagefile.files[0]!);
    },
    (data: ResourceTelemetry): void => {
      data.pagefile.files = Array.from({ length: MAX_PAGEFILES + 1 }, (_, index) => ({
        ...data.pagefile.files[0]!,
        index: index + 1,
      }));
    },
    (data: ResourceTelemetry): void => {
      data.pagefile.file_count.minimum = 0.5;
    },
    (data: ResourceTelemetry): void => {
      data.warnings = ['partial_coverage', 'partial_coverage'];
    },
    (data: ResourceTelemetry): void => {
      partial(data, 90, 0.99);
    },
    (data: ResourceTelemetry): void => {
      partial(data, 120, 1);
    },
  ])(
    'rejects impossible statistics, inconsistent metadata and duplicate/oversized arrays %#',
    mutate => {
      const data = fixture();
      mutate(data);
      expect(resourceTelemetrySchema.safeParse(data).success).toBe(false);
    },
  );
});
