import { cx } from '../../styled-system/css';
import { input } from '../../styled-system/recipes';

import type { JSX, ComponentPropsWithRef } from 'react';

export function Input({
  className,
  ...props
}: Readonly<ComponentPropsWithRef<'input'>>): JSX.Element {
  return <input {...props} className={cx(input(), className)} />;
}
