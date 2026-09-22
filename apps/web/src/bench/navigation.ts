const browsePath = '/bench/';
const storageKey = 'bench:last-browse';
let inMemoryBrowse: string | undefined;

export function rememberBrowse(url: string): void {
  inMemoryBrowse = url;

  try {
    sessionStorage.setItem(storageKey, url);
  } catch {
    /* Storage is optional. */
  }
}

export function lastBrowse(): string {
  if (inMemoryBrowse) {
    return inMemoryBrowse;
  }

  try {
    const value = sessionStorage.getItem(storageKey);

    if (value && (value === browsePath || value.startsWith(`${browsePath}?`))) {
      return value;
    }
  } catch {
    /* Private browsing can disable storage. */
  }

  return browsePath;
}

export function browseUrl(params: URLSearchParams): string {
  const query = params.toString();

  return browsePath + (query ? `?${query}` : '');
}

export function resetPage(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);

  for (const key of ['cursor', 'expanded', 'item_cursor']) {
    next.delete(key);
  }

  return next;
}

export function searchParameters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('expanded');
  next.delete('item_cursor');

  return next;
}
