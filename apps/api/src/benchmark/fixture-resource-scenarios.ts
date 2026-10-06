import { createResourceTelemetryFixture } from './fixture-resource-telemetry';

import type { Hardware, ResourceMetric, ResourceTelemetry } from '@timmy/contracts';

const gib = 2 ** 30;
type Statistics = Readonly<[average: number, minimum: number, maximum: number, last: number]>;
export const resourceScenarios = [
  'normal',
  'near_full_vram',
  'low_available_ram',
  'low_commit_headroom',
  'partial',
  'unavailable',
  'multiple_pagefiles',
] as const;
export type ResourceScenario = (typeof resourceScenarios)[number] | 'uma';

function statistics(metric: ResourceMetric, values: Statistics): void {
  const scale = metric.unit === 'bytes' ? gib : 1;
  const sample = (value: number): number =>
    metric.unit === 'bytes' ? Math.round(value * gib) : value;
  const [average, minimum, maximum, last] = values;
  Object.assign(metric, {
    average: average * scale,
    minimum: sample(minimum),
    maximum: sample(maximum),
    last: sample(last),
  });
}

function normal(telemetry: ResourceTelemetry): void {
  const { cpu, gpu, ram, pagefile, commit } = telemetry;
  statistics(cpu.total_utilization, [38, 9.5, 62, 41]);

  for (const processor of cpu.logical_processors) {
    const average = 38 + (processor.index - (cpu.logical_processors.length - 1) / 2) * 2;
    statistics(processor.utilization, [average, average / 4, average + 24, average + 3]);
  }

  statistics(gpu.graphics_utilization, [85, 52, 96, 81]);
  statistics(gpu.dedicated_memory_used, [6, 5, 7, 6.5]);
  statistics(gpu.shared_memory_used, [0.5, 0.125, 1, 0.5]);
  const usable = ram.os_usable_capacity.value! / gib;
  statistics(ram.physical_used, [10, 8, 12, 10]);
  statistics(ram.physical_available, [usable - 10, usable - 12, usable - 8, usable - 10]);
  statistics(pagefile.used, [2, 1, 3, 2]);
  statistics(pagefile.files[0]!.used, [2, 1, 3, 2]);
  const limit = commit.limit.average! / gib;
  statistics(commit.used, [12, 10, 14, 12]);
  statistics(commit.headroom, [limit - 12, limit - 14, limit - 10, limit - 12]);
}

function lowRam(telemetry: ResourceTelemetry): void {
  const usable = telemetry.ram.os_usable_capacity.value! / gib;
  const limit = telemetry.commit.limit.average! / gib;
  statistics(telemetry.ram.physical_available, [0.75, 0.125, 2, 0.5]);
  statistics(telemetry.ram.physical_used, [
    usable - 0.75,
    usable - 2,
    usable - 0.125,
    usable - 0.5,
  ]);
  statistics(telemetry.commit.used, [usable + 1.25, usable, usable + 1.875, usable + 1.5]);
  statistics(telemetry.commit.headroom, [
    limit - usable - 1.25,
    limit - usable - 1.875,
    limit - usable,
    limit - usable - 1.5,
  ]);
}

function lowCommit(telemetry: ResourceTelemetry): void {
  const limit = telemetry.commit.limit.average! / gib;
  statistics(telemetry.commit.used, [limit - 1, limit - 2, limit - 0.125, limit - 0.5]);
  statistics(telemetry.commit.headroom, [1, 0.125, 2, 0.5]);
}

function unavailable(
  metric: ResourceMetric,
  reason: 'collector_unavailable' | 'counter_unavailable',
): void {
  Object.assign(metric, {
    average: null,
    minimum: null,
    maximum: null,
    last: null,
    valid_sample_count: 0,
    valid_duration_sec: 0,
    coverage: 0,
    status: 'unavailable',
    reason_codes: [reason],
  });
}

function unavailableCapture(telemetry: ResourceTelemetry): void {
  const { cpu, gpu, ram, pagefile, commit } = telemetry;

  for (const metric of [
    cpu.total_utilization,
    gpu.graphics_utilization,
    gpu.dedicated_memory_used,
    gpu.shared_memory_used,
    ram.physical_used,
    ram.physical_available,
    pagefile.file_count,
    pagefile.allocated,
    pagefile.used,
    commit.used,
    commit.limit,
    commit.headroom,
  ]) {
    unavailable(metric, 'collector_unavailable');
  }

  cpu.logical_processors = [];
  pagefile.files = [];
  telemetry.status = 'unavailable';
  telemetry.warnings = ['collector_unavailable'];
}

function multiplePagefiles(telemetry: ResourceTelemetry): void {
  const { pagefile, commit } = telemetry;
  const second = structuredClone(pagefile.files[0]!);
  second.index = 2;
  second.drive_media_type = 'HDD';
  statistics(second.allocated, [8, 8, 8, 8]);
  statistics(second.used, [1, 1, 1, 1]);

  for (const metric of [second.allocated, second.used]) {
    Object.assign(metric, {
      valid_duration_sec: 60,
      valid_sample_count: 60,
      coverage: 0.5,
      status: 'partial',
      reason_codes: ['partial_coverage'],
    });
  }

  pagefile.files.push(second);
  statistics(pagefile.file_count, [1.5, 1, 2, 2]);
  statistics(pagefile.allocated, [28, 24, 32, 32]);
  statistics(pagefile.used, [2.5, 1, 4, 3]);
  const limit = commit.limit.minimum! / gib;
  statistics(commit.used, [14, 14, 14, 14]);
  statistics(commit.limit, [limit + 4, limit, limit + 8, limit + 8]);
  statistics(commit.headroom, [limit - 10, limit - 14, limit - 6, limit - 6]);
}

// Invented capture summaries for seed/demo consumers only. Never normalize a real submission here.
export function createResourceScenario(
  hardware: Hardware,
  scenario: ResourceScenario,
): ResourceTelemetry {
  const telemetry = createResourceTelemetryFixture(hardware);
  normal(telemetry);

  switch (scenario) {
    case 'near_full_vram': {
      const capacity = telemetry.gpu.dedicated_vram_capacity.value! / gib;
      statistics(telemetry.gpu.dedicated_memory_used, [
        capacity * 0.9,
        capacity * 0.82,
        capacity * 0.98,
        capacity * 0.94,
      ]);
      break;
    }

    case 'low_available_ram':
      lowRam(telemetry);
      break;
    case 'low_commit_headroom':
      lowCommit(telemetry);
      break;
    case 'partial':
      telemetry.status = 'partial';
      Object.assign(telemetry.cpu.total_utilization, {
        status: 'partial',
        coverage: 0.75,
        valid_duration_sec: 90,
        valid_sample_count: 90,
        reason_codes: ['partial_coverage'],
      });
      unavailable(telemetry.gpu.graphics_utilization, 'counter_unavailable');
      telemetry.pagefile.automatic_management = null;
      telemetry.warnings = [
        'partial_coverage',
        'counter_unavailable',
        'pagefile_management_unknown',
      ];
      break;
    case 'unavailable':
      unavailableCapture(telemetry);
      break;
    case 'multiple_pagefiles':
      multiplePagefiles(telemetry);
      break;
    case 'uma':
      telemetry.gpu.memory_architecture = 'unified';
      telemetry.gpu.dedicated_vram_capacity = {
        ...telemetry.gpu.dedicated_vram_capacity,
        value: 0,
        source: 'd3d12_unified_memory_no_discrete_vram',
      };
      statistics(telemetry.gpu.dedicated_memory_used, [0, 0, 0, 0]);
      statistics(telemetry.gpu.shared_memory_used, [2, 1.5, 3, 2.5]);
      telemetry.ram.os_usable_capacity.value = (hardware.ram_gb - 4) * gib;
      statistics(telemetry.ram.physical_available, [
        hardware.ram_gb - 14,
        hardware.ram_gb - 16,
        hardware.ram_gb - 12,
        hardware.ram_gb - 14,
      ]);
      statistics(telemetry.commit.limit, [
        hardware.ram_gb + 19,
        hardware.ram_gb + 19,
        hardware.ram_gb + 19,
        hardware.ram_gb + 19,
      ]);
      statistics(telemetry.commit.headroom, [
        hardware.ram_gb + 7,
        hardware.ram_gb + 5,
        hardware.ram_gb + 9,
        hardware.ram_gb + 7,
      ]);
      break;
    case 'normal':
      break;
  }

  return telemetry;
}
