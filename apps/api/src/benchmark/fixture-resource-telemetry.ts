import type { Hardware, ResourceMetric, ResourceTelemetry } from '@timmy/contracts';

// Synthetic fixture values only; never used to fill missing submission measurements.
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

export function createResourceTelemetryFixture(
  hardware: Hardware,
  duration = 120,
): ResourceTelemetry {
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
      logical_processors: Array.from(
        { length: hardware.cpu.name === 'Core i5-12400F' ? 12 : 16 },
        (_, index) => ({
          group: 0,
          index,
          utilization: sampled(
            50,
            'percent',
            'pdh_processor_information_processor_time',
            'logical_processor',
          ),
        }),
      ),
    },
    gpu: {
      adapter_name: hardware.gpu.name,
      scope: 'whole_adapter',
      memory_architecture: 'discrete',
      selection_method: 'tarkov_graphics_activity',
      selection_status: 'selected',
      dedicated_vram_capacity: capacity(
        hardware.gpu.name === 'GeForce RTX 3060 Ti' ? 8 : 12,
        'dxgi_dedicated_video_memory',
        'whole_adapter',
      ),
      graphics_utilization: sampled(
        85,
        'percent',
        'pdh_gpu_engine_3d_busiest_engine',
        'whole_adapter',
      ),
      dedicated_memory_used: sampled(
        6 * gib,
        'bytes',
        'pdh_gpu_adapter_memory_dedicated',
        'whole_adapter',
      ),
      shared_memory_used: sampled(gib, 'bytes', 'pdh_gpu_adapter_memory_shared', 'whole_adapter'),
    },
    ram: {
      installed_capacity: capacity(hardware.ram_gb, 'get_physically_installed_system_memory'),
      os_usable_capacity: capacity(hardware.ram_gb - 1, 'get_performance_info_physical_total'),
      physical_used: memory(12),
      physical_available: memory(hardware.ram_gb - 13),
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
    commit: {
      used: memory(14),
      limit: memory(hardware.ram_gb + 22),
      headroom: memory(hardware.ram_gb + 8),
    },
    warnings: [],
  };
}
