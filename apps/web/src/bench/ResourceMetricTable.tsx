import { css } from '../../styled-system/css';

import { number, words } from './format';
import { resourceCoverage, resourceReasons, resourceValue } from './resource-telemetry-format';
import { muted } from './styles';

import type { ResourceMetric } from '@timmy/contracts';
import type { JSX } from 'react';

const cell = css({
  borderBottomWidth: '1px',
  borderColor: 'border.default',
  p: '3',
  textAlign: 'right',
  verticalAlign: 'top',
});

export function ResourceMetricTable({
  caption,
  rows,
}: Readonly<{
  caption: string;
  rows: ReadonlyArray<readonly [string, ResourceMetric]>;
}>): JSX.Element {
  return (
    <div
      role="region"
      aria-label={`${caption} scroll area`}
      tabIndex={0}
      className={css({ overflowX: 'auto' })}
    >
      <table
        className={css({
          width: '100%',
          minWidth: '40rem',
          textStyle: 'body-sm',
          borderCollapse: 'collapse',
        })}
      >
        <caption
          className={css({ textAlign: 'left', textStyle: 'caption', color: 'fg.muted', pb: '2' })}
        >
          {caption}
        </caption>
        <thead>
          <tr>
            {['Metric', 'Average', 'Minimum', 'Maximum', 'Last', 'Coverage'].map(label => (
              <th
                key={label}
                scope="col"
                className={label === 'Metric' ? `${cell} ${css({ textAlign: 'left' })}` : cell}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, metric]) => (
            <tr key={label}>
              <th
                scope="row"
                className={`${cell} ${css({ textAlign: 'left', fontWeight: 'normal' })}`}
              >
                <span className={css({ fontWeight: 'semibold' })}>{label}</span>
                <p className={muted}>{words(metric.status)}</p>
                {metric.reason_codes.length > 0 && (
                  <p className={muted}>{resourceReasons(metric.reason_codes)}</p>
                )}
              </th>
              {metric.status === 'unavailable' ? (
                <td colSpan={4} className={cell}>
                  Unavailable
                </td>
              ) : (
                [metric.average, metric.minimum, metric.maximum, metric.last].map(
                  (value, index) => (
                    <td
                      key={index}
                      className={`${cell} ${css({ whiteSpace: 'nowrap', fontFamily: 'mono' })}`}
                    >
                      {resourceValue(value, metric.unit)}
                    </td>
                  ),
                )
              )}
              <td className={cell}>
                <span className={css({ fontFamily: 'mono' })}>
                  {resourceCoverage(metric.coverage)}
                </span>
                <p className={`${muted} ${css({ whiteSpace: 'nowrap' })}`}>
                  {number(metric.valid_sample_count)} samples · {number(metric.valid_duration_sec)}{' '}
                  s valid
                </p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
