import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSyntheticRuns } from '../../api/src/benchmark/fixtures';
import { projectResourceTelemetrySummary } from '../../api/src/benchmark/resource-telemetry-projection';

import App from './App';
import { rememberBrowse } from './bench/navigation';
const session = vi.hoisted(() => ({
  status: 'signed-in',
  sessionKey: 'session-one',
  signOut: vi.fn(),
}));
vi.mock('./auth/BrowserAuth', async importOriginal => ({
  ...(await importOriginal<object>()),
  useBrowserSession: (): typeof session => session,
}));
const emptyMessage = 'No submissions match this status.';
const signedOut = 'signed-out';
const pageTitle = 'My Bench';
const request = vi.fn<typeof fetch>();
const item = {
  client_run_id: '00000000-0000-4000-8000-000000000001',
  publication_status: 'pending_review',
  public_run_id: null,
  url: null,
  submitted_at: '2026-09-26T10:00:00Z',
  captured_day: '2026-09-25',
  hardware: { cpu: 'Private owner CPU', gpu: 'Test GPU', ram_gb: 32 },
  map: { id: 'woods', name: 'Woods' },
  execution: 'bsg_servers',
  game_resolution: null,
  metrics: { average_fps: 100, one_percent_low_fps: 80 },
  resource_telemetry: projectResourceTelemetrySummary(
    createSyntheticRuns()[0]!.detail.resource_telemetry,
  ),
  status_reason: null,
};
const publishedItem = {
  ...item,
  publication_status: 'published',
  public_run_id: 'br_test',
  url: '/bench/runs/br_test',
};
const deleteLabel = 'Delete publication';
const confirmLabel = 'Yes, delete publication';

function response(items: unknown[] = [item], cursor: string | null = null): Response {
  return Response.json({ status_filter: 'all', limit: 20, items, next_cursor: cursor });
}

function tree(): React.ReactNode {
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

function start(path = '/bench/me'): ReturnType<typeof render> {
  window.history.replaceState(null, '', path);

  return render(tree());
}

beforeEach(() => {
  session.status = 'signed-in';
  session.sessionKey = 'session-one';
  rememberBrowse('/bench/?map=woods');
  request.mockReset().mockImplementation(() => Promise.resolve(response()));
  vi.stubGlobal('fetch', request);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe(pageTitle, () => {
  it('confirms deletion, prevents duplicate requests and refreshes the first filtered page', async () => {
    let finish!: (value: Response) => void;
    request.mockResolvedValueOnce(response([publishedItem]));
    request.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    request.mockImplementation(() => Promise.resolve(response([])));
    start('/bench/me?status=published&limit=10&cursor=own_page');
    fireEvent.click(await screen.findByRole('button', { name: deleteLabel }));
    const cancel = screen.getByRole('button', { name: 'No, keep it' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    expect(request).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: deleteLabel }));
    fireEvent.click(screen.getByRole('button', { name: deleteLabel }));
    fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
    fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toBe('/api/bench/v1/me/runs/br_test');
    expect(request.mock.calls[1]?.[1]?.method).toBe('DELETE');
    expect(screen.getByRole('button', { name: confirmLabel }).hasAttribute('disabled')).toBe(true);
    await act(async () => {
      finish(Response.json({ publication_status: 'deleted', public_run_id: 'br_test' }));
      await Promise.resolve();
    });
    await screen.findByText(emptyMessage);
    expect(window.location.search).toBe('?status=published&limit=10');
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.at(-1)?.[0]).toBe('/api/bench/v1/me/runs?status=published&limit=10');
  });

  it.each(['network', 'invalid receipt', 'wrong ID', 'forbidden'])(
    'keeps the row and permits an idempotent retry after %s',
    async failure => {
      request.mockResolvedValueOnce(response([publishedItem]));

      if (failure === 'network') {
        request.mockRejectedValueOnce(new Error('private server information'));
      } else {
        request.mockResolvedValueOnce(
          Response.json(
            failure === 'invalid receipt'
              ? {}
              : { publication_status: 'deleted', public_run_id: 'br_other' },
            { status: failure === 'forbidden' ? 403 : 200 },
          ),
        );
      }

      request.mockResolvedValueOnce(
        Response.json({ publication_status: 'deleted', public_run_id: 'br_test' }),
      );
      request.mockImplementation(() => Promise.resolve(response([])));
      start();
      fireEvent.click(await screen.findByRole('button', { name: deleteLabel }));
      fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
      expect((await screen.findByRole('alert')).textContent).toBe(
        'Unable to confirm deletion. Please retry.',
      );
      expect(screen.getByRole('article')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
      await screen.findByText(emptyMessage);
      expect(request.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(2);
    },
  );

  it('aborts deletion on logout and ignores a late acknowledgement', async () => {
    let finish!: (value: Response) => void;
    request.mockResolvedValueOnce(response([publishedItem]));
    request.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const view = start();
    fireEvent.click(await screen.findByRole('button', { name: deleteLabel }));
    fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
    const signal = request.mock.calls[1]?.[1]?.signal;
    session.status = signedOut;
    view.rerender(tree());
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish(Response.json({ publication_status: 'deleted', public_run_id: 'br_test' }));
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('does not offer deletion for an unpublished submission', async () => {
    start();
    await screen.findByRole('article');
    expect(screen.queryByRole('button', { name: deleteLabel })).toBeNull();
  });
  it.each([signedOut, 'loading', 'unavailable'])(
    'does not request private data while %s',
    status => {
      session.status = status;
      start();
      expect(screen.getByRole('heading', { name: pageTitle })).toBeTruthy();
      expect(request).not.toHaveBeenCalled();

      if (status === signedOut) {
        expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toContain(
          'returnTo=/bench/me',
        );
      }
    },
  );
  it('shows pending and published runs and links only the published one', async () => {
    request.mockResolvedValue(
      response([
        item,
        {
          ...item,
          client_run_id: '00000000-0000-4000-8000-000000000002',
          publication_status: 'published',
          public_run_id: 'br_test',
          url: '/bench/runs/br_test',
        },
      ]),
    );
    start();
    await screen.findAllByRole('article');
    expect(screen.getAllByText('Resources · Available')).toHaveLength(2);
    expect(screen.getByText('Published', { selector: 'p' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Open public run →' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'BENCH' }).getAttribute('href')).toBe(
      '/bench/?map=woods',
    );
    expect(document.body.textContent).not.toContain(item.client_run_id);
  });
  it('paginates and clears the cursor when filtering', async () => {
    request.mockResolvedValueOnce(response([item], 'own_next')).mockResolvedValue(response([]));
    start();
    fireEvent.click(await screen.findByRole('button', { name: 'Next page →' }));
    await screen.findByText(emptyMessage);
    expect(window.location.search).toContain('cursor=own_next');
    fireEvent.change(screen.getByLabelText('Publication status'), {
      target: { value: 'rejected' },
    });
    await waitFor(() => expect(request.mock.calls.at(-1)?.[0]).toContain('status=rejected'));
    expect(window.location.search).not.toContain('cursor');
  });
  it('clears private data on logout and on a change of session', async () => {
    const view = start();
    await screen.findByText(/Private owner CPU/);
    session.sessionKey = 'session-two';
    request.mockResolvedValue(response([]));
    view.rerender(tree());
    expect(screen.queryByText(/Private owner CPU/)).toBeNull();
    await screen.findByText(emptyMessage);
    session.status = signedOut;
    view.rerender(tree());
    expect(screen.queryByRole('region', { name: 'Your submissions' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });
  it('ignores a late response after signing out', async () => {
    let finish: (value: Response) => void = () => {};

    request.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const view = start();
    session.status = signedOut;
    view.rerender(tree());
    await act(async () => {
      finish(response());
      await Promise.resolve();
    });
    expect(screen.queryByText(/Private owner CPU/)).toBeNull();
  });
  it('offers first-page recovery for an expired cursor', async () => {
    request.mockResolvedValue(
      Response.json(
        { code: 'cursor_stale', message: 'private detail', request_id: 'req_test' },
        { status: 409 },
      ),
    );
    start('/bench/me?cursor=own_old');
    expect((await screen.findByRole('alert')).textContent).toContain('Results have changed');
    expect(document.body.textContent).not.toContain('private detail');
    request.mockResolvedValue(response([]));
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    await screen.findByText(emptyMessage);
    expect(window.location.search).not.toContain('cursor');
  });
  it('opens My Bench from the profile menu', async () => {
    start('/unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.click(screen.getByRole('link', { name: pageTitle }));
    await screen.findByText('Pending review');
    expect(window.location.pathname).toBe('/bench/me');
    expect(document.title).toBe('My Bench · Timmy Academy');
  });
});
