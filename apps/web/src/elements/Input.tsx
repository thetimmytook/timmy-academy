import { cx } from '../../styled-system/css';
import { input } from '../../styled-system/recipes';

import type { ComponentPropsWithRef } from 'react';

export function Input({ className, ...props }: Readonly<ComponentPropsWithRef<'input'>>) {
  return <input {...props} className={cx(input(), className)} />;
}
