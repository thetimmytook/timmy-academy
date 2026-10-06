import { z } from 'zod';

import {
  RESOURCE_COMPLETE_COVERAGE_TOLERANCE,
  RESOURCE_COVERAGE_ROUNDING_TOLERANCE,
  RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC,
} from './resource-telemetry-precision.js';

export const resourceReasonSchema = z.enum([
  'not_collected',
  'counter_unavailable',
  'window_unavailable',
  'summary_unavailable',
  'collector_unavailable',
  'active_adapter_unknown',
  'multiple_active_adapters',
  'linked_adapter_unsupported',
  'memory_architecture_unknown',
  'partial_coverage',
  'pagefile_management_unknown',
]);
export const resourceReasonsSchema = z
  .array(resourceReasonSchema)
  .max(16)
  .refine(codes => new Set(codes).size === codes.length, 'Reason codes must be unique.');

// Zod numbers reject NaN and infinity at the boundary.
const measuredValue = z.number().min(0).max(Number.MAX_SAFE_INTEGER);
const metricFields = z.strictObject({
  average: measuredValue.nullable(),
  minimum: measuredValue.nullable(),
  maximum: measuredValue.nullable(),
  last: measuredValue.nullable(),
  valid_sample_count: z.number().int().min(0).max(10000),
  valid_duration_sec: z.number().min(0),
  coverage: z.number().min(0).max(1),
  status: z.enum(['available', 'partial', 'unavailable']),
  reason_codes: resourceReasonsSchema,
});

export type ResourceMetric = z.infer<typeof metricFields> & {
  unit: 'bytes' | 'percent' | 'count';
  source: string;
  scope: string;
};

export function sampledResourceSchema(
  unit: 'bytes' | 'percent' | 'count',
  source: string,
  scope: string,
): z.ZodType<ResourceMetric> {
  const value = unit === 'percent' ? measuredValue.max(100) : measuredValue;

  return metricFields
    .extend({
      average: value.nullable(),
      minimum: value.nullable(),
      maximum: value.nullable(),
      last: value.nullable(),
      unit: z.literal(unit),
      source: z.literal(source),
      scope: z.literal(scope),
    })
    .superRefine((metric, context) => {
      const values = [metric.average, metric.minimum, metric.maximum, metric.last];

      if (metric.status === 'unavailable') {
        if (
          values.some(value => value !== null) ||
          metric.valid_sample_count !== 0 ||
          metric.valid_duration_sec !== 0 ||
          metric.coverage !== 0 ||
          metric.reason_codes.length === 0 ||
          metric.reason_codes.includes('partial_coverage')
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'Unavailable metrics require null values, zero support and an unavailable reason.',
          });
        }

        return;
      }

      if (values.some(value => value === null) || metric.valid_sample_count === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Measured metrics require statistics and valid samples.',
        });

        return;
      }

      const minimum = metric.minimum!;
      const maximum = metric.maximum!;
      const slack = Number.EPSILON * Math.max(1, maximum) * 8;

      if (
        minimum > maximum ||
        metric.average! < minimum - slack ||
        metric.average! > maximum + slack ||
        metric.last! < minimum ||
        metric.last! > maximum
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Statistics must lie within the measured minimum and maximum.',
        });
      }

      if (
        unit === 'count' &&
        [minimum, maximum, metric.last].some(value => !Number.isInteger(value))
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Sampled counts must be integers; a weighted average may be fractional.',
        });
      }

      const maxSampleDuration = source.startsWith('pdh_') && unit === 'percent' ? 1.5 : 1;

      if (
        metric.valid_duration_sec >
        metric.valid_sample_count * maxSampleDuration + RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Valid duration exceeds the supported sample duration.',
        });
      }

      if (
        metric.status === 'available' &&
        (metric.coverage <
          1 - (RESOURCE_COMPLETE_COVERAGE_TOLERANCE + RESOURCE_COVERAGE_ROUNDING_TOLERANCE) ||
          metric.reason_codes.length !== 0)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Available metrics require complete coverage and no failure reasons.',
        });
      }

      if (
        metric.status === 'partial' &&
        (metric.coverage >=
          1 - (RESOURCE_COMPLETE_COVERAGE_TOLERANCE - RESOURCE_COVERAGE_ROUNDING_TOLERANCE) ||
          metric.reason_codes.length !== 1 ||
          metric.reason_codes[0] !== 'partial_coverage')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Partial metrics require incomplete coverage and the partial coverage reason.',
        });
      }
    });
}

type ResourceCapacity = {
  value: number | null;
  unit: 'bytes';
  source: string;
  scope: string;
  status: 'available' | 'unavailable';
  reason_codes: z.infer<typeof resourceReasonsSchema>;
};

export function resourceCapacitySchema(source: string, scope: string): z.ZodType<ResourceCapacity> {
  return z
    .strictObject({
      value: measuredValue.int().nullable(),
      unit: z.literal('bytes'),
      source: z.literal(source),
      scope: z.literal(scope),
      status: z.enum(['available', 'unavailable']),
      reason_codes: resourceReasonsSchema,
    })
    .superRefine((capacity, context) => {
      if (
        capacity.status === 'available'
          ? capacity.value === null || capacity.reason_codes.length !== 0
          : capacity.value !== null ||
            capacity.reason_codes.length === 0 ||
            capacity.reason_codes.includes('partial_coverage')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Capacity value, status and reasons are inconsistent.',
        });
      }
    });
}
