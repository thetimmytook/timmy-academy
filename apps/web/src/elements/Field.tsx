import { css, cx } from '../../styled-system/css';

import type { ComponentPropsWithRef, ReactNode } from 'react';

type FieldProps = ComponentPropsWithRef<'label'> & { label: ReactNode };

export function Field({ label, children, className, ...props }: Readonly<FieldProps>) {
  return (
    <label
      {...props}
      className={cx(css({ display: 'grid', gap: 'field', minWidth: 0 }), className)}
    >
      <span className={css({ textStyle: 'label' })}>{label}</span>
      {children}
    </label>
  );
}
