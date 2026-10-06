import { css } from '../../styled-system/css';
import { DefinitionList } from '../elements/DefinitionList';

import { execution, number, resolution, words } from './format';
import { PublicSettings } from './PublicSettings';
import { ResourceTelemetry } from './ResourceTelemetry';
import { stack } from './styles';

import type { ModerationQueue } from '@timmy/contracts';
import type { JSX } from 'react';

export function SubmissionReview({
  run,
}: Readonly<{ run: ModerationQueue['items'][number]['run'] }>): JSX.Element {
  const conditions = run.conditions;

  return (
    <details className={stack}>
      <summary className={css({ cursor: 'pointer', fontWeight: 'semibold', mb: '3' })}>
        Review measurement
      </summary>
      <div className={stack}>
        <DefinitionList
          values={[
            ['Captured', run.captured_day],
            ['CPU', run.hardware.cpu.name],
            ['GPU', run.hardware.gpu.name],
            ['Hardware RAM', `${run.hardware.ram_gb} GB`],
            ['Tuning', words(run.hardware.tuning_class ?? 'unknown')],
            ['Map', conditions.map.name],
            ['Execution', execution(conditions.execution)],
            ['Resolution', resolution(conditions.game_resolution)],
            ['Game version', conditions.game_version ?? 'Unknown'],
            ['Weather', words(conditions.weather)],
            ['Time of day', words(conditions.time_of_day)],
            ['Capture duration', `${number(run.capture.duration_sec)} seconds`],
            ['Frame samples', number(run.capture.sample_count)],
            ['Average FPS', number(run.metrics.average_fps)],
            ['1% low FPS', number(run.metrics.one_percent_low_fps)],
            ['0.1% low FPS', number(run.metrics.zero_point_one_percent_low_fps)],
            ['Average frametime', `${number(run.metrics.average_frametime_ms)} ms`],
            ['p95 frametime', `${number(run.metrics.p95_frametime_ms)} ms`],
            ['p99 frametime', `${number(run.metrics.p99_frametime_ms)} ms`],
          ]}
        />
        <ResourceTelemetry telemetry={run.resource_telemetry} />
        <PublicSettings settings={run.settings} />
      </div>
    </details>
  );
}
