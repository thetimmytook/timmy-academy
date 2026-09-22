import { css } from '../../styled-system/css';
import { Button } from '../elements/Button';

import { browseUrl } from './navigation';

function pageUrl(params: URLSearchParams, cursor: string | null, key = 'cursor') {
  const next = new URLSearchParams(params);

  if (key === 'cursor') {
    next.delete('expanded');
    next.delete('item_cursor');
  }

  next.delete(key);

  if (cursor) {
    next.set(key, cursor);
  }

  return browseUrl(next);
}

export function RunPagination({
  params,
  next,
  item = false,
}: Readonly<{
  params: URLSearchParams;
  next: string | null;
  item?: boolean;
}>) {
  const key = item ? 'item_cursor' : 'cursor';

  return (
    <nav
      aria-label={item ? 'Run pages' : 'Hardware pages'}
      className={css({ display: 'flex', flexWrap: 'wrap', gap: '4' })}
    >
      {params.has(key) && (
        <Button href={pageUrl(params, null, key)}>First {item ? 'run' : 'hardware'} page</Button>
      )}
      {next && (
        <Button href={pageUrl(params, next, key)}>
          Next {item ? 'runs' : 'hardware configurations'} →
        </Button>
      )}
    </nav>
  );
}
