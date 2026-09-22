import { navigate } from '../routing';

import type { ComponentPropsWithRef } from 'react';

export function Link({ href, onClick, ...props }: Readonly<ComponentPropsWithRef<'a'>>) {
  return (
    <a
      {...props}
      href={href}
      onClick={event => {
        onClick?.(event);

        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target ||
          props.download !== undefined ||
          !href?.startsWith('/') ||
          href.startsWith('//')
        ) {
          return;
        }

        event.preventDefault();
        navigate(href);
      }}
    />
  );
}
