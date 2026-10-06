import { z } from 'zod';

import { MAX_LOGICAL_PROCESSORS, MAX_PAGEFILES } from './limits.js';
import {
  resourceCapacitySchema,
  resourceReasonsSchema,
  sampledResourceSchema,
} from './resource-metric.js';
import { checkResourceTelemetry } from './resource-telemetry-checks.js';

import type { ResourceMetric } from './resource-metric.js';

const memory = (scope = 'whole_system'): z.ZodType<ResourceMetric> =>
  sampledResourceSchema('bytes', 'get_performance_info', scope);
const pagefileMemory = (scope = 'whole_system'): z.ZodType<ResourceMetric> =>
  sampledResourceSchema('bytes', 'enum_page_files', scope);
const adapterName = z
  .string()
  .min(1)
  .max(160)
  .refine(
    name =>
      !/\p{Cc}/u.test(name) &&
      !/[:@\\/]/.test(name) &&
      !/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(name) &&
      !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(name),
    'Adapter name must be a sanitized model label.',
  );

const telemetryDocumentSchema = z.strictObject({
  schema_version: z.literal(1),
  status: z.enum(['available', 'partial', 'unavailable', 'not_collected']),
  window: z.strictObject({
    requested_duration_sec: z.union([z.literal(0), z.literal(120), z.literal(240)]),
    duration_sec: z.number().positive().nullable(),
    target_interval_sec: z.literal(1),
    expected_sample_count: z.number().int().min(0),
    alignment: z.enum(['presentmon_qpc_valid_frame_intervals', 'unknown']),
    coverage_method: z.literal('valid_interval_duration_gauges_capped_at_one_second'),
  }),
  cpu: z.strictObject({
    total_utilization: sampledResourceSchema(
      'percent',
      'pdh_processor_information_processor_time',
      'whole_system',
    ),
    logical_processors: z
      .array(
        z.strictObject({
          group: z.number().int().min(0).max(65535),
          index: z.number().int().min(0).max(63),
          utilization: sampledResourceSchema(
            'percent',
            'pdh_processor_information_processor_time',
            'logical_processor',
          ),
        }),
      )
      .max(MAX_LOGICAL_PROCESSORS),
  }),
  gpu: z.strictObject({
    adapter_name: adapterName.nullable(),
    scope: z.literal('whole_adapter'),
    memory_architecture: z.enum(['discrete', 'unified', 'unknown']),
    selection_method: z.enum(['tarkov_graphics_activity', 'single_hardware_adapter', 'unknown']),
    selection_status: z.enum(['selected', 'unknown']),
    dedicated_vram_capacity: z.union([
      resourceCapacitySchema('dxgi_dedicated_video_memory', 'whole_adapter'),
      resourceCapacitySchema('d3d12_unified_memory_no_discrete_vram', 'whole_adapter'),
    ]),
    graphics_utilization: sampledResourceSchema(
      'percent',
      'pdh_gpu_engine_3d_busiest_engine',
      'whole_adapter',
    ),
    dedicated_memory_used: sampledResourceSchema(
      'bytes',
      'pdh_gpu_adapter_memory_dedicated',
      'whole_adapter',
    ),
    shared_memory_used: sampledResourceSchema(
      'bytes',
      'pdh_gpu_adapter_memory_shared',
      'whole_adapter',
    ),
  }),
  ram: z.strictObject({
    installed_capacity: resourceCapacitySchema(
      'get_physically_installed_system_memory',
      'whole_system',
    ),
    os_usable_capacity: resourceCapacitySchema(
      'get_performance_info_physical_total',
      'whole_system',
    ),
    physical_used: memory(),
    physical_available: memory(),
  }),
  pagefile: z.strictObject({
    automatic_management: z.boolean().nullable(),
    automatic_management_source: z.literal('win32_computer_system_automatic_managed_pagefile'),
    automatic_management_scope: z.literal('system_policy'),
    file_count: sampledResourceSchema('count', 'enum_page_files', 'whole_system'),
    allocated: pagefileMemory(),
    used: pagefileMemory(),
    files: z
      .array(
        z.strictObject({
          index: z.number().int().min(1).max(MAX_PAGEFILES),
          drive_media_type: z.enum(['HDD', 'SSD', 'SCM', 'unknown']),
          allocated: pagefileMemory('pagefile'),
          used: pagefileMemory('pagefile'),
        }),
      )
      .max(MAX_PAGEFILES),
  }),
  commit: z.strictObject({ used: memory(), limit: memory(), headroom: memory() }),
  warnings: resourceReasonsSchema,
});

export type ResourceTelemetry = z.infer<typeof telemetryDocumentSchema>;

export const resourceTelemetrySchema = telemetryDocumentSchema.superRefine(checkResourceTelemetry);

// Owner cards retain aggregate measurements without expanding every processor/file.
export const resourceTelemetrySummarySchema = telemetryDocumentSchema.extend({
  cpu: telemetryDocumentSchema.shape.cpu.omit({ logical_processors: true }),
  pagefile: telemetryDocumentSchema.shape.pagefile.omit({ files: true }),
});
export type ResourceTelemetrySummary = z.infer<typeof resourceTelemetrySummarySchema>;
