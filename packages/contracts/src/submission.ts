import { z } from 'zod';

import {
  executionSchema,
  hardwareSchema,
  metricsSchema,
  namedModelSchema,
  publicRunDetailSchema,
  resolutionSchema,
} from './benchmark.js';
import { MIN_CAPTURE_DURATION_SEC, MIN_CAPTURE_SAMPLE_COUNT } from './limits.js';
import { clientRunIdSchema } from './owner-runs.js';
import { RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC } from './resource-telemetry-precision.js';
import { resourceTelemetrySchema } from './resource-telemetry.js';
import { settingsSnapshotSchema } from './settings-snapshot.js';

const CAPTURE_DURATION_ROUNDING_TOLERANCE_SEC = 0.0005;
const AVERAGE_METRIC_ROUNDING_TOLERANCE = 0.005;
const CAPTURE_FLOATING_POINT_SLACK = 1e-9;

// CaptureWindow.FromFrames merges adjacent intervals separated by at most 1 microsecond.
const RESOURCE_FRAME_INTERVAL_MERGE_GAP_SEC = 1e-6;

// Accepted rounding: duration to 0.001 s; FPS and frametime to at least 0.01.
// Desktop currently records frametime more precisely (0.001 ms).
function isConsistentCapture(
  capture: { duration_sec: number; sample_count: number },
  metrics: { average_fps: number; average_frametime_ms: number },
): boolean {
  const count = capture.sample_count;
  const earliest = Math.max(
    capture.duration_sec - CAPTURE_DURATION_ROUNDING_TOLERANCE_SEC,
    (count * (metrics.average_frametime_ms - AVERAGE_METRIC_ROUNDING_TOLERANCE)) / 1000,
    count / (metrics.average_fps + AVERAGE_METRIC_ROUNDING_TOLERANCE),
  );
  const latest = Math.min(
    capture.duration_sec + CAPTURE_DURATION_ROUNDING_TOLERANCE_SEC,
    (count * (metrics.average_frametime_ms + AVERAGE_METRIC_ROUNDING_TOLERANCE)) / 1000,
    metrics.average_fps > AVERAGE_METRIC_ROUNDING_TOLERANCE
      ? count / (metrics.average_fps - AVERAGE_METRIC_ROUNDING_TOLERANCE)
      : Infinity,
  );

  // Floating-point slack at interval boundaries, not a measurement tolerance.
  return earliest <= latest + CAPTURE_FLOATING_POINT_SLACK;
}

export const submissionRequestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    client_run_id: clientRunIdSchema,
    captured_day: z.iso.date(),
    app_version: z.string().min(1).max(160),
    hardware: z.strictObject({
      cpu_name: hardwareSchema.shape.cpu.shape.name,
      gpu_name: hardwareSchema.shape.gpu.shape.name,
      ram_gb: hardwareSchema.shape.ram_gb,
      tuning_class: publicRunDetailSchema.shape.hardware.shape.tuning_class,
    }),
    map: namedModelSchema.shape.id,
    execution: executionSchema,
    game_resolution: resolutionSchema.nullable(),
    game_version: publicRunDetailSchema.shape.conditions.shape.game_version,
    context: z.strictObject({
      weather: publicRunDetailSchema.shape.conditions.shape.weather,
      time_of_day: publicRunDetailSchema.shape.conditions.shape.time_of_day,
    }),
    settings_snapshot: settingsSnapshotSchema.nullable(),
    capture: z.strictObject({
      duration_sec: z.number().min(MIN_CAPTURE_DURATION_SEC),
      sample_count: z.number().int().min(MIN_CAPTURE_SAMPLE_COUNT),
    }),
    metrics: metricsSchema,
    resource_telemetry: resourceTelemetrySchema,
  })
  .superRefine((request, context) => {
    const { metrics, capture } = request;
    const telemetryDuration = request.resource_telemetry.window.duration_sec;

    if (
      telemetryDuration !== null &&
      telemetryDuration >
        capture.duration_sec +
          CAPTURE_DURATION_ROUNDING_TOLERANCE_SEC +
          RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC +
          (capture.sample_count - 1) * RESOURCE_FRAME_INTERVAL_MERGE_GAP_SEC +
          CAPTURE_FLOATING_POINT_SLACK
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resource_telemetry', 'window', 'duration_sec'],
        message: 'Telemetry interval union must fit within the accepted FPS frame intervals.',
      });
    }

    if (!isConsistentCapture(capture, metrics)) {
      context.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: 'Capture duration, sample count and average metrics are inconsistent.',
      });
    }

    if (
      metrics.one_percent_low_fps > metrics.average_fps ||
      metrics.zero_point_one_percent_low_fps > metrics.one_percent_low_fps
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: 'Low FPS metrics must not exceed their wider averages.',
      });
    }

    if (metrics.p95_frametime_ms > metrics.p99_frametime_ms) {
      context.addIssue({
        code: 'custom',
        path: ['metrics', 'p99_frametime_ms'],
        message: 'P99 frametime must not be less than P95.',
      });
    }

    const saved = request.settings_snapshot?.graphics?.DisplaySettings?.Resolution;

    if (
      saved &&
      (request.game_resolution?.width !== saved.Width ||
        request.game_resolution.height !== saved.Height)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['game_resolution'],
        message: 'Resolution must match the selected settings.',
      });
    }
  });

export type SubmissionRequest = z.infer<typeof submissionRequestSchema>;

export const submissionResponseSchema = z.discriminatedUnion('publication_status', [
  z.strictObject({
    client_run_id: clientRunIdSchema,
    publication_status: z.literal('rejected'),
    public_run_id: z.null(),
    url: z.null(),
    status_reason: z.literal('rejected'),
  }),
  z.strictObject({
    client_run_id: clientRunIdSchema,
    publication_status: z.literal('pending_review'),
    public_run_id: z.null(),
    url: z.null(),
  }),
  z.strictObject({
    client_run_id: clientRunIdSchema,
    publication_status: z.literal('published'),
    public_run_id: publicRunDetailSchema.shape.public_run_id,
    url: publicRunDetailSchema.shape.url,
  }),
]);
export type SubmissionResponse = z.infer<typeof submissionResponseSchema>;
