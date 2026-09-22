import { useState } from 'react';

import { css } from '../../styled-system/css';
import { panel } from '../../styled-system/recipes';
import { Button } from '../elements/Button';
import { DefinitionList } from '../elements/DefinitionList';

import { execution, number, resolution, words } from './format';
import { PublicSettings } from './PublicSettings';
import { grid, muted, stack } from './styles';

import type { PublicRunDetail } from '@timmy/contracts';
import type { JSX } from 'react';

export function RunDetails({ run }: Readonly<{ run: PublicRunDetail }>): JSX.Element {
  const [copied, setCopied] = useState('');
  const conditions = run.conditions;
  const metrics: [string, number, string][] = [
    ['Average FPS', run.metrics.average_fps, 'FPS'],
    ['1% low', run.metrics.one_percent_low_fps, 'FPS'],
    ['0.1% low', run.metrics.zero_point_one_percent_low_fps, 'FPS'],
    ['Average frametime', run.metrics.average_frametime_ms, 'ms'],
    ['p95 frametime', run.metrics.p95_frametime_ms, 'ms'],
    ['p99 frametime', run.metrics.p99_frametime_ms, 'ms'],
  ];

  return (
    <>
      <div>
        <p className={css({ textStyle: 'eyebrow', color: 'brand.default' })}>Public run</p>
        <h1 tabIndex={-1} className={css({ textStyle: 'h1' })}>
          {conditions.map.name} benchmark
        </h1>
        <p className={muted}>
          Captured {run.captured_day} · {run.author?.display_name ?? 'Anonymous contributor'}
        </p>
        <p className={css({ textStyle: 'caption', overflowWrap: 'anywhere', color: 'fg.muted' })}>
          {run.public_run_id}
        </p>
        <Button
          variant="link"
          onClick={() => {
            void Promise.resolve()
              .then(() =>
                navigator.clipboard.writeText(new URL(run.url, window.location.origin).href),
              )
              .then(
                () => setCopied('Link copied.'),
                () => setCopied('Could not copy. Copy the address from your browser.'),
              );
          }}
        >
          Copy run link
        </Button>
        <p role="status">{copied}</p>
      </div>
      <section className={`${panel()} ${stack}`}>
        <h2 className={css({ textStyle: 'h2' })}>
          {run.hardware.cpu.name} · {run.hardware.gpu.name} · {run.hardware.ram_gb} GB RAM
        </h2>
        <p className={muted}>One capture. These metrics are not an average of different runs.</p>
        <dl
          className={css({
            display: 'grid',
            gap: '5',
            gridTemplateColumns: {
              base: 'repeat(2, minmax(0, 1fr))',
              tablet: 'repeat(3, minmax(0, 1fr))',
            },
          })}
        >
          {metrics.map(([label, value, unit]) => (
            <div key={label}>
              <dt className={muted}>{label}</dt>
              <dd>
                <span className={css({ textStyle: 'metric-xl' })}>{number(value)}</span>{' '}
                <span className={muted}>{unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <div className={grid}>
        <section className={`${panel()} ${css({ gridColumn: { tablet: 'span 2' } })}`}>
          <h2 className={css({ textStyle: 'h3', mb: '4' })}>Run conditions</h2>
          <DefinitionList
            values={[
              ['Map', conditions.map.name],
              ['Execution', execution(conditions.execution)],
              ['Game resolution', resolution(conditions.game_resolution)],
              ['Game version', conditions.game_version ?? 'Unknown'],
              ['Weather', words(conditions.weather)],
              ['Time of day', words(conditions.time_of_day)],
              ['Render scale', 'Unknown'],
              ['Upscaling', 'Unknown'],
            ]}
          />
          <p className={`${muted} ${css({ mt: '3' })}`}>
            Game resolution is the selected in-game screen resolution. Recorded scaling modes, when
            available, appear in Public settings.
          </p>
        </section>
        <section className={`${panel()} ${css({ gridColumn: { tablet: 'span 2' } })}`}>
          <h2 className={css({ textStyle: 'h3', mb: '4' })}>Capture and hardware</h2>
          <DefinitionList
            values={[
              ['CPU', run.hardware.cpu.name],
              ['GPU', run.hardware.gpu.name],
              ['Installed RAM', `${run.hardware.ram_gb} GB`],
              ['Tuning', words(run.hardware.tuning_class ?? 'unknown')],
              ['Capture duration', `${number(run.capture.duration_sec)} seconds`],
              ['Frame samples', number(run.capture.sample_count)],
            ]}
          />
        </section>
      </div>
      <PublicSettings settings={run.settings} />
    </>
  );
}
