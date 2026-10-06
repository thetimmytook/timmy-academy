import { mapCatalog } from './catalog';
import { normalizeHardware } from './hardware-normalization';
import { BenchmarkRequestError } from './repository';
import { projectResourceTelemetry } from './resource-telemetry-projection';
import { projectSubmissionSettings } from './submission-settings';

import type { SubmissionData } from './d1-submission-writer';
import type { SubmissionRequest } from '@timmy/contracts';

// Called after request validation. Intake metadata stays outside the public run document.
export async function normalizeSubmission(request: SubmissionRequest): Promise<SubmissionData> {
  const map = mapCatalog.find(candidate => candidate.id === request.map);

  if (!map) {
    throw new BenchmarkRequestError('invalid_input');
  }

  const hardware = await normalizeHardware(request.hardware);

  return {
    captured_day: request.captured_day,
    hardware: {
      ...hardware,
      ...(request.hardware.tuning_class !== undefined
        ? { tuning_class: request.hardware.tuning_class }
        : {}),
    },
    conditions: {
      map,
      execution: request.execution,
      game_resolution: request.game_resolution,
      game_version: request.game_version,
      weather: request.context.weather,
      time_of_day: request.context.time_of_day,
      render_scale: null,
      upscaling: null,
    },
    capture: request.capture,
    metrics: request.metrics,
    resource_telemetry: projectResourceTelemetry(request.resource_telemetry),
    settings: projectSubmissionSettings(request.settings_snapshot),
    quality_notes: [],
    author: null,
  };
}
