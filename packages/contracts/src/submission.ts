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
import { settingsSnapshotSchema } from './settings-snapshot.js';

// Accepted rounding: duration to 0.001 s; FPS and frametime to at least 0.01.
// Desktop currently records frametime more precisely (0.001 ms).
function isConsistentCapture(
  capture: { duration_sec: number; sample_count: number },
  metrics: { average_fps: number; average_frametime_ms: number },
): boolean {
  const count = capture.sample_count;
  const earliest = Math.max(
    capture.duration_sec - 0.0005,
    (count * (metrics.average_frametime_ms - 0.005)) / 1000,
    count / (metrics.average_fps + 0.005),
  );
  const latest = Math.min(
    capture.duration_sec + 0.0005,
    (count * (metrics.average_frametime_ms + 0.005)) / 1000,
    metrics.average_fps > 0.005 ? count / (metrics.average_fps - 0.005) : Infinity,
  );

  // Floating-point slack at interval boundaries, not a measurement tolerance.
  return earliest <= latest + 1e-9;
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
  })
  .superRefine((request, context) => {
    const { metrics, capture } = request;

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
