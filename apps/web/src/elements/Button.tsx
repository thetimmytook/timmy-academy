import { cx } from '../../styled-system/css';
import { button } from '../../styled-system/recipes';

import { Link } from './Link';

import type { ButtonVariantProps } from '../../styled-system/recipes';
import type { ComponentPropsWithRef } from 'react';

type ButtonProps = ButtonVariantProps &
  (
    | (ComponentPropsWithRef<'button'> & { href?: never })
    | (ComponentPropsWithRef<'a'> & { href: string })
  );

export function Button(props: Readonly<ButtonProps>) {
  if (props.href !== undefined) {
    const { variant, size, className, ...attributes } = props;
    return <Link {...attributes} className={cx(button({ variant, size }), className)} />;
  }
  const { variant, size, className, type = 'button', ...attributes } = props;
  return (
    <button {...attributes} type={type} className={cx(button({ variant, size }), className)} />
  );
}
