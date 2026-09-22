import { css } from '../../styled-system/css';

import type { JSX, ReactNode } from 'react';

export function DefinitionList({
  values,
}: Readonly<{ values: ReadonlyArray<readonly [string, ReactNode]> }>): JSX.Element {
  return (
    <dl className={css({ display: 'grid', gap: '3' })}>
      {values.map(([label, value]) => (
        <div
          key={label}
          className={css({
            display: 'flex',
            flexWrap: 'wrap',
            gap: '2',
            justifyContent: 'space-between',
            borderBottomWidth: '1px',
            borderBottomStyle: 'solid',
            borderColor: 'border.default',
            pb: '2',
          })}
        >
          <dt className={css({ color: 'fg.muted', textStyle: 'body-sm' })}>{label}</dt>
          <dd className={css({ overflowWrap: 'anywhere' })}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
