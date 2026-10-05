import { resourceTelemetrySchema, resourceTelemetrySummarySchema } from '@timmy/contracts';
import { describe, expect, it } from 'vitest';

import { createSyntheticRuns } from './fixtures';
import { projectDetail } from './projection';
import {
  projectResourceTelemetry,
  projectResourceTelemetrySummary,
} from './resource-telemetry-projection';

describe('resource telemetry projections', () => {
  it('retains all approved measurements and metadata, with compact owner aggregates', () => {
    const telemetry = createSyntheticRuns()[0]!.detail.resource_telemetry;
    expect(resourceTelemetrySchema.parse(projectResourceTelemetry(telemetry))).toEqual(telemetry);
    const summary = resourceTelemetrySummarySchema.parse(
      projectResourceTelemetrySummary(telemetry),
    );
    expect(summary.cpu.total_utilization).toEqual(telemetry.cpu.total_utilization);
    expect(summary.pagefile.used).toEqual(telemetry.pagefile.used);
    expect(summary).not.toHaveProperty('cpu.logical_processors');
    expect(summary).not.toHaveProperty('pagefile.files');
    expect(resourceTelemetrySummarySchema.safeParse(telemetry).success).toBe(false);
  });

  it('removes private additions at every nested level before projecting a public detail', () => {
    const run = createSyntheticRuns()[0]!;
    const telemetry = run.detail.resource_telemetry;
    const objects = [
      telemetry,
      telemetry.window,
      telemetry.cpu,
      telemetry.cpu.total_utilization,
      telemetry.cpu.logical_processors[0]!,
      telemetry.cpu.logical_processors[0]!.utilization,
      telemetry.gpu,
      telemetry.gpu.dedicated_vram_capacity,
      telemetry.gpu.graphics_utilization,
      telemetry.gpu.dedicated_memory_used,
      telemetry.gpu.shared_memory_used,
      telemetry.ram,
      telemetry.ram.installed_capacity,
      telemetry.ram.os_usable_capacity,
      telemetry.ram.physical_used,
      telemetry.ram.physical_available,
      telemetry.pagefile,
      telemetry.pagefile.file_count,
      telemetry.pagefile.allocated,
      telemetry.pagefile.used,
      telemetry.pagefile.files[0]!,
      telemetry.pagefile.files[0]!.allocated,
      telemetry.pagefile.files[0]!.used,
      telemetry.commit,
      telemetry.commit.used,
      telemetry.commit.limit,
      telemetry.commit.headroom,
    ];
    const expected = structuredClone(telemetry);

    for (const object of objects) {
      Object.assign(object, {
        account_id: 'private-account',
        pid: 123,
        path: 'private-path',
        native_error: 'private-error',
        raw_samples: [123],
      });
    }

    expect(resourceTelemetrySchema.safeParse(telemetry).success).toBe(false);
    expect(projectDetail(run).resource_telemetry).toEqual(expected);
    expect(projectResourceTelemetrySummary(telemetry)).toEqual(
      projectResourceTelemetrySummary(expected),
    );
  });

  it('preserves explicit unavailable nulls and rejects corrupt approved values', () => {
    const run = createSyntheticRuns()[0]!;
    const metric = run.detail.resource_telemetry.cpu.total_utilization;
    Object.assign(metric, {
      average: null,
      minimum: null,
      maximum: null,
      last: null,
      valid_sample_count: 0,
      valid_duration_sec: 0,
      coverage: 0,
      status: 'unavailable',
      reason_codes: ['counter_unavailable'],
    });
    run.detail.resource_telemetry.status = 'partial';
    run.detail.resource_telemetry.warnings = ['counter_unavailable'];
    expect(projectDetail(run).resource_telemetry.cpu.total_utilization.average).toBeNull();
    metric.source = 'private native error';
    expect(() => projectDetail(run)).toThrow();
  });
});
