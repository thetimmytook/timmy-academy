import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';

import { useApiFetch } from './useApiFetch';

import type { JSX } from 'react';

const signOut = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./BrowserAuth', () => ({
  useBrowserSession: (): { signOut: typeof signOut } => ({ signOut }),
}));

function Page({ signal }: Readonly<{ signal?: AbortSignal }>): JSX.Element {
  const apiFetch = useApiFetch();

  return (
    <button onClick={() => void apiFetch('/api/admin/v1/approvals', { signal: signal ?? null })}>
      Refresh
    </button>
  );
}

function SignIn(): JSX.Element {
  const { search } = useLocation();

  return <p>Return to: {new URLSearchParams(search).get('returnTo')}</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  signOut.mockClear();
});

it('ignores a late 401 from an aborted request', async () => {
  const controller = new AbortController();
  const request = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal('fetch', request);
  render(
    <MemoryRouter>
      <Page signal={controller.signal} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('Refresh'));
  controller.abort();
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(signOut).not.toHaveBeenCalled();
});

it.each(['/admin', '/bench/me?status=rejected#runs'])(
  'redirects 401 to login and preserves %s',
  path => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="*" element={<Page />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Refresh'));

    return waitFor(() => {
      expect(screen.getByText('Return to: ' + path)).toBeTruthy();
      expect(signOut).toHaveBeenCalledOnce();
    });
  },
);

it.each([200, 403, 500])('does not sign out or redirect on HTTP %s', async status => {
  const request = vi.fn().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal('fetch', request);
  render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('Refresh'));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(signOut).not.toHaveBeenCalled();
  expect(screen.getByText('Refresh')).toBeTruthy();
});
