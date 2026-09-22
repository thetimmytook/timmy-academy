import { cx } from '../../styled-system/css';
import { callout } from '../../styled-system/recipes';

import type { CalloutVariantProps } from '../../styled-system/recipes';
import type { JSX, ComponentPropsWithRef } from 'react';

type MessageProps = ComponentPropsWithRef<'div'> & CalloutVariantProps;

export function Message({ tone, className, ...props }: Readonly<MessageProps>): JSX.Element {
  return <div {...props} className={cx(callout({ tone }), className)} />;
}
