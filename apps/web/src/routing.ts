import { useSyncExternalStore } from 'react';

function currentUrl() {
  return window.location.pathname + window.location.search;
}

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback);

  return () => window.removeEventListener('popstate', callback);
}

export function useUrl() {
  return useSyncExternalStore(subscribe, currentUrl);
}

export function navigate(url: string, { replace = false }: { replace?: boolean } = {}) {
  if (replace) {
    window.history.replaceState(null, '', url);
  } else {
    window.history.pushState(null, '', url);
  }

  window.dispatchEvent(new PopStateEvent('popstate'));
}
