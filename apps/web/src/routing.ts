import { useSyncExternalStore } from 'react';

function currentUrl(): string {
  return window.location.pathname + window.location.search;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);

  return () => window.removeEventListener('popstate', callback);
}

export function useUrl(): string {
  return useSyncExternalStore(subscribe, currentUrl);
}

export function navigate(url: string, { replace = false }: { replace?: boolean } = {}): void {
  if (replace) {
    window.history.replaceState(null, '', url);
  } else {
    window.history.pushState(null, '', url);
  }

  window.dispatchEvent(new PopStateEvent('popstate'));
}
