import { z } from 'zod';

import {
  executionSchema,
  hardwareSchema,
  metricsSchema,
  namedModelSchema,
  publicRunDetailSchema,
  resolutionSchema,
} from './benchmark.js';
import { clientRunIdSchema } from './owner-runs.js';
import { settingsSnapshotSchema } from './settings-snapshot.js';

// Transport shape only. Cross-metric plausibility checks must precede persistence.
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
      duration_sec: z.number().min(110),
      sample_count: z.number().int().min(120),
    }),
    metrics: metricsSchema,
  })
  .superRefine((request, context) => {
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
