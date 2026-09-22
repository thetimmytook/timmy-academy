import { css, cx } from '../../styled-system/css';
import { input } from '../../styled-system/recipes';

import type { ComponentPropsWithRef } from 'react';

export function Dropdown({ className, ...props }: Readonly<ComponentPropsWithRef<'select'>>) {
  return (
    <span className={css({ position: 'relative', display: 'block', minWidth: 0 })}>
      <select {...props} className={cx(input({ kind: 'select' }), className)} />
      <span
        aria-hidden="true"
        className={css({
          position: 'absolute',
          right: '4',
          top: '50%',
          width: '0.5rem',
          height: '0.5rem',
          borderRight: '2px solid currentColor',
          borderBottom: '2px solid currentColor',
          color: 'fg.muted',
          transform: 'translateY(-75%) rotate(45deg)',
          pointerEvents: 'none',
        })}
      />
    </span>
  );
}
