import { Link as RouterLink, useInRouterContext } from 'react-router';

import type { ComponentPropsWithRef, JSX } from 'react';

export function Link({ href, ...props }: Readonly<ComponentPropsWithRef<'a'>>): JSX.Element {
  const inRouter = useInRouterContext();

  if (inRouter && href?.startsWith('/') && !href.startsWith('//')) {
    return <RouterLink {...props} to={href} reloadDocument={props.download !== undefined} />;
  }

  return <a {...props} href={href} />;
}
