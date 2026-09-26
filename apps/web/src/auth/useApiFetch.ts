import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useBrowserSession } from './BrowserAuth';

export function useApiFetch(): (url: string, init?: RequestInit) => Promise<Response> {
  const { signOut } = useBrowserSession();
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();

  return useCallback(
    async (url, init) => {
      const response = await fetch(url, init);

      if (response.status === 401 && !init?.signal?.aborted) {
        // Clear Clerk's stale local session so sign-in displays the login form.
        try {
          await signOut();
        } catch {
          // Clerk may be unavailable; cleanup must not prevent reaching sign-in.
        }

        await navigate(
          '/sign-in?' + new URLSearchParams({ returnTo: pathname + search + hash }).toString(),
          {
            replace: true,
          },
        );
      }

      return response;
    },
    [signOut, navigate, pathname, search, hash],
  );
}
