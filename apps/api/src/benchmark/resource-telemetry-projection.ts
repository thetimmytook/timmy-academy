import type { ResourceMetric, ResourceTelemetry, ResourceTelemetrySummary } from '@timmy/contracts';

function projectMetric<Source extends string>(
  metric: ResourceMetric<Source>,
): ResourceMetric<Source> {
  return {
    average: metric.average,
    minimum: metric.minimum,
    maximum: metric.maximum,
    last: metric.last,
    valid_sample_count: metric.valid_sample_count,
    valid_duration_sec: metric.valid_duration_sec,
    coverage: metric.coverage,
    unit: metric.unit,
    source: metric.source,
    scope: metric.scope,
    status: metric.status,
    reason_codes: [...metric.reason_codes],
  };
}

function projectCapacity(
  capacity: ResourceTelemetry['ram']['installed_capacity'],
): ResourceTelemetry['ram']['installed_capacity'] {
  return {
    value: capacity.value,
    unit: capacity.unit,
    source: capacity.source,
    scope: capacity.scope,
    status: capacity.status,
    reason_codes: [...capacity.reason_codes],
  };
}

export function projectResourceTelemetrySummary(
  telemetry: ResourceTelemetry,
): ResourceTelemetrySummary {
  const { window, cpu, gpu, ram, pagefile, commit } = telemetry;

  return {
    schema_version: telemetry.schema_version,
    status: telemetry.status,
    window: {
      requested_duration_sec: window.requested_duration_sec,
      duration_sec: window.duration_sec,
      target_interval_sec: window.target_interval_sec,
      expected_sample_count: window.expected_sample_count,
      alignment: window.alignment,
      coverage_method: window.coverage_method,
    },
    cpu: { total_utilization: projectMetric(cpu.total_utilization) },
    gpu: {
      adapter_name: gpu.adapter_name,
      scope: gpu.scope,
      memory_architecture: gpu.memory_architecture,
      selection_method: gpu.selection_method,
      selection_status: gpu.selection_status,
      dedicated_vram_capacity: projectCapacity(gpu.dedicated_vram_capacity),
      graphics_utilization: projectMetric(gpu.graphics_utilization),
      dedicated_memory_used: projectMetric(gpu.dedicated_memory_used),
      shared_memory_used: projectMetric(gpu.shared_memory_used),
    },
    ram: {
      installed_capacity: projectCapacity(ram.installed_capacity),
      os_usable_capacity: projectCapacity(ram.os_usable_capacity),
      physical_used: projectMetric(ram.physical_used),
      physical_available: projectMetric(ram.physical_available),
    },
    pagefile: {
      automatic_management: pagefile.automatic_management,
      automatic_management_source: pagefile.automatic_management_source,
      automatic_management_scope: pagefile.automatic_management_scope,
      file_count: projectMetric(pagefile.file_count),
      allocated: projectMetric(pagefile.allocated),
      used: projectMetric(pagefile.used),
    },
    commit: {
      used: projectMetric(commit.used),
      limit: projectMetric(commit.limit),
      headroom: projectMetric(commit.headroom),
    },
    warnings: [...telemetry.warnings],
  };
}

export function projectResourceTelemetry(telemetry: ResourceTelemetry): ResourceTelemetry {
  const summary = projectResourceTelemetrySummary(telemetry);

  return {
    ...summary,
    cpu: {
      ...summary.cpu,
      logical_processors: telemetry.cpu.logical_processors.map(processor => ({
        group: processor.group,
        index: processor.index,
        utilization: projectMetric(processor.utilization),
      })),
    },
    pagefile: {
      ...summary.pagefile,
      files: telemetry.pagefile.files.map(file => ({
        index: file.index,
        drive_media_type: file.drive_media_type,
        allocated: projectMetric(file.allocated),
        used: projectMetric(file.used),
      })),
    },
  };
}
