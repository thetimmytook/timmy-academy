import type { ResourceMetric } from './resource-metric';
import type { ResourceTelemetry } from './resource-telemetry';

const gib = 2 ** 30;

function metric(
  value: number,
  unit: ResourceMetric['unit'],
  source: string,
  scope = 'whole_system',
  duration = 120,
): ResourceMetric {
  return {
    average: value,
    minimum: value,
    maximum: value,
    last: value,
    valid_sample_count: Math.ceil(duration),
    valid_duration_sec: duration,
    coverage: 1,
    unit,
    source,
    scope,
    status: 'available',
    reason_codes: [],
  };
}

export function createResourceTelemetryFixture(duration = 120): ResourceTelemetry {
  const sampled = (
    value: number,
    unit: ResourceMetric['unit'],
    source: string,
    scope = 'whole_system',
  ): ResourceMetric => metric(value, unit, source, scope, duration);
  const memory = (value: number, scope = 'whole_system'): ResourceMetric =>
    sampled(value * gib, 'bytes', 'get_performance_info', scope);
  const fileMemory = (value: number, scope = 'whole_system'): ResourceMetric =>
    sampled(value * gib, 'bytes', 'enum_page_files', scope);
  const capacity = (
    value: number,
    source: string,
    scope = 'whole_system',
  ): ResourceTelemetry['ram']['installed_capacity'] => ({
    value: value * gib,
    unit: 'bytes',
    source,
    scope,
    status: 'available',
    reason_codes: [],
  });

  return {
    schema_version: 1,
    status: 'available',
    window: {
      requested_duration_sec: 120,
      duration_sec: duration,
      target_interval_sec: 1,
      expected_sample_count: Math.ceil(duration),
      alignment: 'presentmon_qpc_valid_frame_intervals',
      coverage_method: 'valid_interval_duration_gauges_capped_at_one_second',
    },
    cpu: {
      total_utilization: sampled(50, 'percent', 'pdh_processor_information_processor_time'),
      logical_processors: [0, 1, 2, 3].map(index => ({
        group: 0,
        index,
        utilization: sampled(
          50,
          'percent',
          'pdh_processor_information_processor_time',
          'logical_processor',
        ),
      })),
    },
    gpu: {
      adapter_name: 'GeForce RTX 4070 SUPER',
      scope: 'whole_adapter',
      memory_architecture: 'discrete',
      selection_method: 'tarkov_graphics_activity',
      selection_status: 'selected',
      dedicated_vram_capacity: capacity(12, 'dxgi_dedicated_video_memory', 'whole_adapter'),
      graphics_utilization: sampled(
        85,
        'percent',
        'pdh_gpu_engine_3d_busiest_engine',
        'whole_adapter',
      ),
      dedicated_memory_used: sampled(
        8 * gib,
        'bytes',
        'pdh_gpu_adapter_memory_dedicated',
        'whole_adapter',
      ),
      shared_memory_used: sampled(gib, 'bytes', 'pdh_gpu_adapter_memory_shared', 'whole_adapter'),
    },
    ram: {
      installed_capacity: capacity(32, 'get_physically_installed_system_memory'),
      os_usable_capacity: capacity(31, 'get_performance_info_physical_total'),
      physical_used: memory(12),
      physical_available: memory(19),
    },
    pagefile: {
      automatic_management: true,
      automatic_management_scope: 'system_policy',
      automatic_management_source: 'win32_computer_system_automatic_managed_pagefile',
      file_count: sampled(1, 'count', 'enum_page_files'),
      allocated: fileMemory(24),
      used: fileMemory(2),
      files: [
        {
          index: 1,
          drive_media_type: 'SSD',
          allocated: fileMemory(24, 'pagefile'),
          used: fileMemory(2, 'pagefile'),
        },
      ],
    },
    commit: { used: memory(14), limit: memory(54), headroom: memory(40) },
    warnings: [],
  };
}

export function createUnavailableMetricFixture(
  metric: ResourceMetric,
  reason: 'collector_unavailable' | 'not_collected' | 'active_adapter_unknown',
): ResourceMetric {
  return {
    ...metric,
    average: null,
    minimum: null,
    maximum: null,
    last: null,
    valid_sample_count: 0,
    valid_duration_sec: 0,
    coverage: 0,
    status: 'unavailable',
    reason_codes: [reason],
  };
}

export function createMissingResourceTelemetryFixture(
  status: 'unavailable' | 'not_collected',
): ResourceTelemetry {
  const data = createResourceTelemetryFixture();
  const reason = status === 'not_collected' ? 'not_collected' : 'collector_unavailable';
  const missingCapacity = (
    capacity: ResourceTelemetry['ram']['installed_capacity'],
    reasonCode: ResourceMetric['reason_codes'][number] = reason,
  ): typeof capacity => ({
    ...capacity,
    value: null,
    status: 'unavailable',
    reason_codes: [reasonCode],
  });
  data.status = status;
  data.window = {
    ...data.window,
    requested_duration_sec: status === 'not_collected' ? 0 : 120,
    duration_sec: null,
    alignment: 'unknown',
    expected_sample_count: 0,
  };
  data.cpu = {
    total_utilization: createUnavailableMetricFixture(data.cpu.total_utilization, reason),
    logical_processors: [],
  };
  data.gpu = {
    ...data.gpu,
    adapter_name: null,
    memory_architecture: 'unknown',
    selection_method: 'unknown',
    selection_status: 'unknown',
    dedicated_vram_capacity: {
      ...missingCapacity(data.gpu.dedicated_vram_capacity),
      reason_codes: ['active_adapter_unknown'],
    },
    graphics_utilization: createUnavailableMetricFixture(
      data.gpu.graphics_utilization,
      'active_adapter_unknown',
    ),
    dedicated_memory_used: createUnavailableMetricFixture(
      data.gpu.dedicated_memory_used,
      'active_adapter_unknown',
    ),
    shared_memory_used: createUnavailableMetricFixture(
      data.gpu.shared_memory_used,
      'active_adapter_unknown',
    ),
  };
  data.ram = {
    installed_capacity: missingCapacity(data.ram.installed_capacity),
    os_usable_capacity: missingCapacity(data.ram.os_usable_capacity),
    physical_used: createUnavailableMetricFixture(data.ram.physical_used, reason),
    physical_available: createUnavailableMetricFixture(data.ram.physical_available, reason),
  };
  data.pagefile = {
    ...data.pagefile,
    automatic_management: null,
    files: [],
    file_count: createUnavailableMetricFixture(data.pagefile.file_count, reason),
    allocated: createUnavailableMetricFixture(data.pagefile.allocated, reason),
    used: createUnavailableMetricFixture(data.pagefile.used, reason),
  };
  data.commit = {
    used: createUnavailableMetricFixture(data.commit.used, reason),
    limit: createUnavailableMetricFixture(data.commit.limit, reason),
    headroom: createUnavailableMetricFixture(data.commit.headroom, reason),
  };
  data.warnings = [reason, 'active_adapter_unknown', 'pagefile_management_unknown'];

  return data;
}
