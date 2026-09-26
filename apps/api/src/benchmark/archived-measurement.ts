import { publicRunDetailSchema } from '@timmy/contracts';

import type { PublicRunDetail } from '@timmy/contracts';
import type { z } from 'zod';

// An explicit allowlist, independent of public IDs, capture date and author metadata.
export const archivedMeasurementSchema = publicRunDetailSchema.pick({
  hardware: true,
  conditions: true,
  capture: true,
  metrics: true,
  settings: true,
});
export type ArchivedMeasurement = z.infer<typeof archivedMeasurementSchema>;

export function projectArchivedMeasurement(run: PublicRunDetail): ArchivedMeasurement {
  return archivedMeasurementSchema.parse({
    hardware: run.hardware,
    conditions: run.conditions,
    capture: run.capture,
    metrics: run.metrics,
    settings: run.settings,
  });
}
