import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { moderationRunSchema } from '@timmy/contracts';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSyntheticRuns } from '../../api/src/benchmark/fixtures';

import App from './App';

const session = vi.hoisted(() => ({
  status: 'signed-in',
  sessionKey: 'admin-one',
  canModerate: true,
  signOut: vi.fn(),
}));
vi.mock('./auth/BrowserAuth', async importOriginal => ({
  ...(await importOriginal<object>()),
  useBrowserSession: (): typeof session => session,
}));
const request = vi.fn<typeof fetch>();
const item = {
  submission_id: 1,
  submitted_at: '2026-09-26T10:00:00Z',
  run: moderationRunSchema.strip().parse(createSyntheticRuns()[0]!.detail),
};
const signedOut = 'signed-out';
const confirmApproval = 'Confirm approval';
const sessionChange = 'session change';
const empty = 'No pending submissions on this page.';
const unavailable = 'Unable to confirm the decision. Please retry.';
const queue = (items = [item], next: number | null = null): Response =>
  Response.json({ items, next_after: next });

function tree(): React.ReactNode {
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

function start(): ReturnType<typeof render> {
  window.history.replaceState(null, '', '/admin');

  return render(tree());
}

beforeEach(() => {
  session.status = 'signed-in';
  session.canModerate = true;
  session.sessionKey = 'admin-one';
  request.mockReset().mockImplementation(() => Promise.resolve(queue()));
  vi.stubGlobal('fetch', request);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Admin approvals', () => {
  it('shows server denial when the browser still has an old admin role', async () => {
    request.mockResolvedValueOnce(
      Response.json(
        { code: 'forbidden', message: 'private details', request_id: 'req_test' },
        { status: 403 },
      ),
    );
    start();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Administrator access is required.',
    );
    expect(screen.queryByRole('article')).toBeNull();
    expect(document.body.textContent).not.toContain('private details');
  });

  it('retries the same decision after a lost response', async () => {
    request.mockResolvedValueOnce(queue());
    request.mockRejectedValueOnce(new Error('connection lost'));
    request.mockResolvedValueOnce(
      Response.json({ submission_id: 1, publication_status: 'published' }),
    );
    request.mockImplementation(() => Promise.resolve(queue([])));
    start();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: confirmApproval }));
    await screen.findByText(unavailable);
    fireEvent.click(screen.getByRole('button', { name: confirmApproval }));
    await screen.findByText(empty);
    expect(request.mock.calls[1]?.[0]).toBe(request.mock.calls[2]?.[0]);
    expect(request.mock.calls[2]?.[1]?.method).toBe('POST');
  });

  it.each([signedOut, 'loading', 'unavailable', 'ordinary'])(
    'does not fetch the queue for %s',
    status => {
      session.status = status === 'ordinary' ? 'signed-in' : status;
      session.canModerate = false;
      start();
      expect(request).not.toHaveBeenCalled();

      if (status === signedOut) {
        expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
          '/sign-in?returnTo=/admin',
        );
      }
    },
  );

  it('shows the selected Approvals navigation and complete measurement review', async () => {
    start();
    await screen.findByRole('article');
    expect(screen.getByRole('link', { name: 'Approvals' }).getAttribute('aria-current')).toBe(
      'page',
    );
    fireEvent.click(screen.getByText('Review measurement'));
    expect(screen.getByText('Frame samples')).toBeTruthy();
    expect(screen.getByText('p99 frametime')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Public settings' })).toBeTruthy();
    expect(screen.queryByText('Copy run link')).toBeNull();
  });

  it.each(['approve', 'reject'])(
    'confirms %s, blocks double clicks and refreshes after success',
    async decision => {
      let finish!: (value: Response) => void;
      request.mockResolvedValueOnce(queue());
      request.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          }),
      );
      request.mockImplementation(() => Promise.resolve(queue([])));
      start();
      const label = decision === 'approve' ? 'Approve' : 'Reject';
      const confirm = decision === 'approve' ? confirmApproval : 'Confirm rejection';
      fireEvent.click(await screen.findByRole('button', { name: label }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(request).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: label }));
      fireEvent.click(screen.getByRole('button', { name: confirm }));
      fireEvent.click(screen.getByRole('button', { name: confirm }));
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[1]?.[0]).toBe('/api/admin/v1/approvals/1/' + decision);
      expect(request.mock.calls[1]?.[1]?.method).toBe('POST');
      expect(screen.getByRole('button', { name: confirm }).hasAttribute('disabled')).toBe(true);
      await act(async () => {
        finish(
          Response.json({
            submission_id: 1,
            publication_status: decision === 'approve' ? 'published' : 'rejected',
          }),
        );
        await Promise.resolve();
      });
      await screen.findByText(empty);
      expect(request).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    { failure: 'network', status: 200, expected: unavailable },
    { failure: 'wrong ID', status: 200, expected: unavailable },
    { failure: 'wrong decision', status: 200, expected: unavailable },
    {
      failure: 'conflict',
      status: 409,
      expected: 'This submission already has a different decision. Refresh the queue.',
    },
    { failure: 'forbidden', status: 403, expected: 'Administrator access is required.' },
  ])(
    'keeps the item after $failure and allows queue refresh',
    async ({ failure, status, expected }) => {
      request.mockResolvedValueOnce(queue());

      if (failure === 'network') {
        request.mockRejectedValueOnce(new Error('private error'));
      } else {
        request.mockResolvedValueOnce(
          Response.json(
            { submission_id: failure === 'wrong ID' ? 2 : 1, publication_status: 'rejected' },
            { status },
          ),
        );
      }

      start();
      fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
      fireEvent.click(screen.getByRole('button', { name: confirmApproval }));
      const message = (await screen.findByRole('alert')).textContent;
      expect(message).toBe(expected);
      expect(screen.getByRole('article')).toBeTruthy();
      request.mockImplementation(() => Promise.resolve(queue([])));
      fireEvent.click(screen.getAllByRole('button', { name: 'Refresh queue' })[0]!);
      await screen.findByText(empty);
    },
  );

  it('returns from a later queue page after a decision', async () => {
    request
      .mockResolvedValueOnce(queue([item], 1))
      .mockResolvedValueOnce(queue([{ ...item, submission_id: 2 }]));
    request.mockResolvedValueOnce(
      Response.json({ submission_id: 2, publication_status: 'rejected' }),
    );
    request.mockImplementation(() => Promise.resolve(queue([])));
    start();
    fireEvent.click(await screen.findByRole('button', { name: 'Next page →' }));
    await waitFor(() =>
      expect(request.mock.calls.at(-1)?.[0]).toBe('/api/admin/v1/approvals?after=1'),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    await screen.findByText(empty);
    expect(request.mock.calls.at(-1)?.[0]).toBe('/api/admin/v1/approvals');
    expect(screen.queryByRole('button', { name: 'First page' })).toBeNull();
  });

  it.each(['logout', 'role removal', sessionChange])(
    'aborts a decision and ignores its late response on %s',
    async change => {
      let finish!: (value: Response) => void;
      request.mockResolvedValueOnce(queue());
      request.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          }),
      );
      request.mockImplementation(() => Promise.resolve(queue([])));
      const view = start();
      fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
      fireEvent.click(screen.getByRole('button', { name: confirmApproval }));
      const signal = request.mock.calls[1]?.[1]?.signal;

      if (change === 'logout') {
        session.status = signedOut;
      }

      if (change === 'role removal') {
        session.canModerate = false;
      }

      if (change === sessionChange) {
        session.sessionKey = 'admin-two';
      }

      view.rerender(tree());
      expect(signal?.aborted).toBe(true);
      await act(async () => {
        finish(Response.json({ submission_id: 1, publication_status: 'published' }));
        await Promise.resolve();
      });
      expect(request).toHaveBeenCalledTimes(change === sessionChange ? 3 : 2);
      expect(screen.queryByRole('article')).toBeNull();
    },
  );
});
