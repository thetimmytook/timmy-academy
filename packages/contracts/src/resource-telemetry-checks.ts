import {
  RESOURCE_COMPLETE_COVERAGE_TOLERANCE,
  RESOURCE_COVERAGE_FLOATING_POINT_SLACK,
  RESOURCE_COVERAGE_ROUNDING_TOLERANCE,
  RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC,
} from './resource-telemetry-precision.js';

import type { ResourceMetric } from './resource-metric.js';
import type { ResourceTelemetry } from './resource-telemetry.js';
import type { z } from 'zod';

type MetricEntry = [(string | number)[], ResourceMetric];

function metricEntries(telemetry: ResourceTelemetry): MetricEntry[] {
  const { cpu, gpu, ram, pagefile, commit } = telemetry;

  return [
    [['cpu', 'total_utilization'], cpu.total_utilization],
    [['gpu', 'graphics_utilization'], gpu.graphics_utilization],
    [['gpu', 'dedicated_memory_used'], gpu.dedicated_memory_used],
    [['gpu', 'shared_memory_used'], gpu.shared_memory_used],
    [['ram', 'physical_used'], ram.physical_used],
    [['ram', 'physical_available'], ram.physical_available],
    [['pagefile', 'file_count'], pagefile.file_count],
    [['pagefile', 'allocated'], pagefile.allocated],
    [['pagefile', 'used'], pagefile.used],
    [['commit', 'used'], commit.used],
    [['commit', 'limit'], commit.limit],
    [['commit', 'headroom'], commit.headroom],
  ];
}

// Core independently rounds duration and coverage to six decimals. The reported
// numbers represent intervals, including near the available/partial threshold.
function isConsistentCoverage(metric: ResourceMetric, duration: number): boolean {
  const earliest =
    Math.max(0, metric.valid_duration_sec - RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC) /
    (duration + RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC);
  const latest =
    (metric.valid_duration_sec + RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC) /
    Math.max(Number.MIN_VALUE, duration - RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC);

  return (
    metric.valid_duration_sec <= duration + 2 * RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC &&
    earliest <=
      metric.coverage +
        RESOURCE_COVERAGE_ROUNDING_TOLERANCE +
        RESOURCE_COVERAGE_FLOATING_POINT_SLACK &&
    latest >=
      metric.coverage -
        RESOURCE_COVERAGE_ROUNDING_TOLERANCE -
        RESOURCE_COVERAGE_FLOATING_POINT_SLACK &&
    (metric.status !== 'available' ||
      latest >=
        1 - RESOURCE_COMPLETE_COVERAGE_TOLERANCE - RESOURCE_COVERAGE_FLOATING_POINT_SLACK) &&
    (metric.status !== 'partial' ||
      earliest < 1 - RESOURCE_COMPLETE_COVERAGE_TOLERANCE + RESOURCE_COVERAGE_FLOATING_POINT_SLACK)
  );
}

function checkWindow(
  window: ResourceTelemetry['window'],
  metrics: MetricEntry[],
  context: z.RefinementCtx,
): void {
  if (
    window.duration_sec === null
      ? window.alignment !== 'unknown' || window.expected_sample_count !== 0
      : window.alignment !== 'presentmon_qpc_valid_frame_intervals' ||
        window.expected_sample_count <
          Math.ceil(window.duration_sec - RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC) ||
        window.expected_sample_count >
          Math.ceil(window.duration_sec + RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['window'],
      message: 'Window duration, alignment and expected sample count are inconsistent.',
    });
  }

  for (const [path, metric] of metrics) {
    if (
      metric.status !== 'unavailable' &&
      (window.duration_sec === null || !isConsistentCoverage(metric, window.duration_sec))
    ) {
      context.addIssue({
        code: 'custom',
        path,
        message: 'Metric support and coverage must belong to this capture window.',
      });
    }
  }
}

function checkGpu(gpu: ResourceTelemetry['gpu'], context: z.RefinementCtx): void {
  const capacity = gpu.dedicated_vram_capacity;
  const unknown = gpu.selection_status === 'unknown';
  const metrics = [gpu.graphics_utilization, gpu.dedicated_memory_used, gpu.shared_memory_used];

  if (
    unknown
      ? gpu.selection_method !== 'unknown' ||
        gpu.adapter_name !== null ||
        gpu.memory_architecture !== 'unknown' ||
        capacity.status !== 'unavailable' ||
        metrics.some(metric => metric.status !== 'unavailable')
      : gpu.selection_method === 'unknown'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['gpu'],
      message: 'Adapter selection and measurements are inconsistent.',
    });
  }

  if (
    gpu.memory_architecture === 'unified'
      ? capacity.source !== 'd3d12_unified_memory_no_discrete_vram' ||
        capacity.status !== 'available' ||
        capacity.value !== 0
      : capacity.source !== 'dxgi_dedicated_video_memory'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['gpu', 'dedicated_vram_capacity'],
      message: 'Capacity must distinguish physical discrete VRAM from unified memory.',
    });
  }

  if (gpu.memory_architecture === 'unknown' && capacity.value !== null) {
    context.addIssue({
      code: 'custom',
      path: ['gpu', 'dedicated_vram_capacity'],
      message: 'Unknown memory architecture has no known physical VRAM capacity.',
    });
  }

  if (
    gpu.memory_architecture === 'discrete' &&
    capacity.value !== null &&
    (capacity.value === 0 || (gpu.dedicated_memory_used.maximum ?? 0) > capacity.value)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['gpu', 'dedicated_memory_used'],
      message: 'Discrete usage must not exceed known physical VRAM capacity.',
    });
  }
}

function checkCollection(
  telemetry: ResourceTelemetry,
  core: MetricEntry[],
  all: MetricEntry[],
  context: z.RefinementCtx,
): void {
  const { window, cpu, ram, pagefile, gpu } = telemetry;
  const capacities = [ram.installed_capacity, ram.os_usable_capacity, gpu.dedicated_vram_capacity];

  if (telemetry.status === 'not_collected') {
    if (
      window.requested_duration_sec !== 0 ||
      window.duration_sec !== null ||
      all.some(([, metric]) => metric.status !== 'unavailable') ||
      capacities.some(capacity => capacity.status !== 'unavailable') ||
      cpu.logical_processors.length !== 0 ||
      pagefile.files.length !== 0 ||
      pagefile.automatic_management !== null ||
      !telemetry.warnings.includes('not_collected')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Not collected must not contain measured telemetry.',
      });
    }

    return;
  }

  let expectedStatus = 'partial';

  if (core.every(([, metric]) => metric.status === 'unavailable')) {
    expectedStatus = 'unavailable';
  } else if (
    core.every(([, metric]) => metric.status === 'available') &&
    capacities.every(capacity => capacity.status === 'available') &&
    pagefile.automatic_management !== null &&
    cpu.logical_processors.length > 0 &&
    cpu.logical_processors.every(processor => processor.utilization.status === 'available')
  ) {
    expectedStatus = 'available';
  }

  if (window.requested_duration_sec === 0 || telemetry.status !== expectedStatus) {
    context.addIssue({
      code: 'custom',
      path: ['status'],
      message: 'Overall collection status must match the collected sections.',
    });
  }
}

function checkWarnings(
  telemetry: ResourceTelemetry,
  core: MetricEntry[],
  context: z.RefinementCtx,
): void {
  const { cpu, ram, pagefile, gpu } = telemetry;
  const capacities = [ram.installed_capacity, ram.os_usable_capacity, gpu.dedicated_vram_capacity];
  const warnings = new Set([
    ...core.flatMap(([, metric]) => metric.reason_codes),
    ...cpu.logical_processors.flatMap(processor => processor.utilization.reason_codes),
    ...capacities.flatMap(capacity => capacity.reason_codes),
    ...(pagefile.automatic_management === null ? ['pagefile_management_unknown'] : []),
  ]);

  if (
    warnings.size !== telemetry.warnings.length ||
    telemetry.warnings.some(reason => !warnings.has(reason))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['warnings'],
      message: 'Warnings must match the collected summary reasons.',
    });
  }
}

function checkRam(ram: ResourceTelemetry['ram'], context: z.RefinementCtx): void {
  const usable = ram.os_usable_capacity.value;

  if (
    ram.installed_capacity.value !== null &&
    usable !== null &&
    usable > ram.installed_capacity.value
  ) {
    context.addIssue({
      code: 'custom',
      path: ['ram'],
      message: 'OS-usable RAM must not exceed installed RAM.',
    });
  }

  if (
    usable !== null &&
    [ram.physical_used.maximum, ram.physical_available.maximum].some(
      value => value !== null && value > usable,
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['ram'],
      message: 'Physical memory must not exceed OS-usable RAM.',
    });
  }
}

export function checkResourceTelemetry(
  telemetry: ResourceTelemetry,
  context: z.RefinementCtx,
): void {
  const { cpu, pagefile } = telemetry;
  const core = metricEntries(telemetry);
  const all: MetricEntry[] = [
    ...core,
    ...cpu.logical_processors.map((processor, index): MetricEntry => [
      ['cpu', 'logical_processors', index, 'utilization'],
      processor.utilization,
    ]),
    ...pagefile.files.flatMap((file, index): MetricEntry[] => [
      [['pagefile', 'files', index, 'allocated'], file.allocated],
      [['pagefile', 'files', index, 'used'], file.used],
    ]),
  ];

  if (
    new Set(cpu.logical_processors.map(processor => `${processor.group}:${processor.index}`))
      .size !== cpu.logical_processors.length
  ) {
    context.addIssue({
      code: 'custom',
      path: ['cpu', 'logical_processors'],
      message: 'Processor group/index pairs must be unique.',
    });
  }

  if (new Set(pagefile.files.map(file => file.index)).size !== pagefile.files.length) {
    context.addIssue({
      code: 'custom',
      path: ['pagefile', 'files'],
      message: 'Pagefile indices must be unique.',
    });
  }

  checkWindow(telemetry.window, all, context);
  checkCollection(telemetry, core, all, context);
  checkWarnings(telemetry, core, context);
  checkGpu(telemetry.gpu, context);
  checkRam(telemetry.ram, context);
}
