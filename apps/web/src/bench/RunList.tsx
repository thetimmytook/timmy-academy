import { css } from '../../styled-system/css';
import { Button } from '../elements/Button';

import { execution, resolution, number } from './format';
import { muted } from './styles';

import type { PublicRunSummary } from '@timmy/contracts';
import type { JSX } from 'react';

export function RunList({ runs }: Readonly<{ runs: PublicRunSummary[] }>): JSX.Element {
  return (
    <ul className={css({ display: 'grid' })}>
      {runs.map(run => (
        <li
          key={run.public_run_id}
          className={css({
            display: 'grid',
            gridTemplateColumns: {
              base: 'repeat(2, minmax(0, 1fr))',
              tablet: '1fr 2fr 0.7fr 0.7fr 1fr',
            },
            gap: '4',
            alignItems: 'center',
            py: '4',
            borderTopWidth: '1px',
            borderTopStyle: 'solid',
            borderColor: 'border.default',
          })}
        >
          <div>
            <strong>{run.map.name}</strong>
            <p className={muted}>{run.captured_day}</p>
          </div>
          <div className={muted}>
            {execution(run.execution)}
            <br />
            {resolution(run.game_resolution)} · Game resolution
            <br />
            Build {run.game_version ?? 'Unknown'}
          </div>
          <div>
            <p className={muted}>Average FPS</p>
            <p className={css({ textStyle: 'metric' })}>{number(run.metrics.average_fps)}</p>
          </div>
          <div>
            <p className={muted}>1% low FPS</p>
            <p className={css({ textStyle: 'metric' })}>
              {number(run.metrics.one_percent_low_fps)}
            </p>
          </div>
          <Button
            variant="link"
            href={run.url}
            aria-label={`Details for ${run.map.name} run ${run.public_run_id}`}
          >
            Details →
          </Button>
        </li>
      ))}
    </ul>
  );
}
