import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the real read-only HTTP contract; server fixtures never enter the web bundle.
import { createSyntheticRuns } from '../../api/src/benchmark/fixtures';
import { InMemoryBenchmarkRepository } from '../../api/src/benchmark/in-memory-repository';
import { createApp } from '../../api/src/index';

import App from './App';
import { rememberBrowse } from './bench/navigation';
import { navigate } from './routing';

let app = createApp();
const nextRuns = 'Next runs →';
const firstRuns = 'First run page';
const publicSettings = 'Public settings';
const request = vi.fn((path: string) => app.request(path));

function start(url = '/bench/') {
  window.history.replaceState(null, '', url);
  return render(<App />);
}

async function results() {
  return screen.findByRole('region', { name: 'Search results' });
}

async function choose(label: string, value: string) {
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>(label).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText<HTMLSelectElement>(label), { target: { value } });
  return results();
}

beforeEach(() => {
  app = createApp();
  sessionStorage.clear();
  rememberBrowse('/bench/');
  request.mockReset().mockImplementation((path: string) => app.request(path));
  vi.stubGlobal('fetch', request);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('public benchmark UI', () => {
  it.each(['', '?ram_gb=32&limit=2'])(
    'redirects the root while preserving query %s',
    async query => {
      const push = vi.spyOn(window.history, 'pushState');
      start('/' + query);
      await results();

      expect(window.location.pathname + window.location.search).toBe('/bench/' + query);
      expect(document.title).toBe('Benchmark · Timmy Academy');
      expect(push).not.toHaveBeenCalled();
      if (query) {
        expect(screen.getByLabelText<HTMLSelectElement>('RAM').value).toBe('32');
        expect(screen.getAllByRole('article')).toHaveLength(1);
      }
    },
  );

  it('updates the title when navigating between unknown, detail and browse routes', async () => {
    start('/unknown');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(document.title).toBe('Page not found · Timmy Academy');

    act(() => navigate(createSyntheticRuns()[0]!.detail.url));
    await screen.findByRole('heading', { name: publicSettings });
    expect(document.title).toBe('Public run · Timmy Academy');

    act(() => navigate('/bench/runs/invalid'));
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(document.title).toBe('Page not found · Timmy Academy');

    fireEvent.click(screen.getByRole('link', { name: 'BENCH' }));
    await results();
    expect(document.title).toBe('Benchmark · Timmy Academy');
  });

  it('keeps BENCH navigation working when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage disabled');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage disabled');
    });
    start('/bench/?ram_gb=32');
    await results();
    fireEvent.click(screen.getAllByRole('link', { name: /Details for/ })[0]!);
    await screen.findByRole('heading', { name: publicSettings });
    expect(screen.getByRole('link', { name: 'BENCH' }).getAttribute('href')).toBe(
      '/bench/?ram_gb=32',
    );
  });
  it('loads unfiltered groups immediately and previews at most three distinct maps per group', async () => {
    start();
    expect(screen.getByText('Loading benchmark results…')).toBeTruthy();
    const region = await results();
    expect(
      within(region).getByText('3 hardware configurations · 24 runs · 6 contributors'),
    ).toBeTruthy();
    for (const article of within(region).getAllByRole('article')) {
      expect(within(article).getAllByRole('listitem')).toHaveLength(3);
      const links = within(article).getAllByRole('link', { name: /Details for/ });
      expect(links).toHaveLength(3);
      expect(
        new Set(links.map(link => link.getAttribute('aria-label')?.split(' run ')[0])).size,
      ).toBe(3);
    }
    expect(request.mock.calls.some(([url]) => url.includes('view=items'))).toBe(false);
    expect(screen.queryByRole('link', { name: 'Search' })).toBeNull();
  });
  it('preserves filtered expansion and run pagination through details, BENCH and browser back', async () => {
    start();
    await choose('RAM', '32');
    fireEvent.click(screen.getByRole('button', { name: /Show all 8 runs/ }));
    await screen.findByRole('link', { name: nextRuns });
    expect(
      request.mock.calls.some(
        ([url]) =>
          url.includes('view=items') && url.includes('group_key=') && url.includes('ram_gb=32'),
      ),
    ).toBe(true);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(screen.getByRole('link', { name: nextRuns }));
    await screen.findByRole('link', { name: firstRuns });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    const browse = window.location.pathname + window.location.search;
    const link = screen.getAllByRole('link', { name: /Details for/ })[0]!;
    const href = link.getAttribute('href');
    fireEvent.click(link);
    await screen.findByRole('heading', { name: publicSettings });
    expect(window.location.pathname).toBe(href);
    expect(screen.getByRole('link', { name: 'BENCH' }).getAttribute('href')).toBe(browse);
    fireEvent.click(screen.getByRole('link', { name: 'BENCH' }));
    await screen.findByRole('link', { name: firstRuns });
    expect(window.location.pathname + window.location.search).toBe(browse);
    expect(screen.getByLabelText<HTMLSelectElement>('RAM').value).toBe('32');
    fireEvent.click(screen.getAllByRole('link', { name: /Details for/ })[0]!);
    await screen.findByRole('heading', { name: publicSettings });
    act(() => {
      window.history.back();
    });
    await screen.findByRole('link', { name: firstRuns });
    expect(window.location.pathname + window.location.search).toBe(browse);
  });
  it('paginates groups and clears both cursors and expansion on filter changes', async () => {
    start('/bench/?limit=2');
    await results();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(screen.getByRole('link', { name: 'Next hardware configurations →' }));
    await screen.findByRole('link', { name: 'First hardware page' });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Show all 8 runs/ }));
    await screen.findByRole('link', { name: nextRuns });
    await choose('Map', 'lighthouse');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('map')).toBe('lighthouse');
    for (const key of ['cursor', 'expanded', 'item_cursor']) {
      expect(params.has(key)).toBe(false);
    }
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
  it('applies all main and additional filters using canonical API values', async () => {
    start();
    await choose('CPU', 'ryzen-7-7800x3d');
    await choose('GPU', 'geforce-rtx-4070-super');
    await choose('RAM', '32');
    await choose('Map', 'lighthouse');
    fireEvent.click(screen.getByText('More conditions'));
    await choose('Execution', 'bsg_servers');
    await choose('Game resolution', '2560x1440');
    await choose('Game version', '0.16.9.0');
    expect(screen.getByText('1 hardware configuration · 2 runs · 1 contributor')).toBeTruthy();
    expect(window.location.search).toContain('game_width=2560&game_height=1440');
    fireEvent.click(screen.getByRole('link', { name: 'Clear filters' }));
    await results();
    expect(window.location.search).toBe('');
  });
  it('opens a direct detail URL after remount, preserving null, absent, false and zero values', async () => {
    const run = createSyntheticRuns()[0]!;
    run.detail.conditions.game_resolution = null;
    run.detail.conditions.game_version = null;
    delete run.detail.hardware.tuning_class;
    app = createApp(new InMemoryBenchmarkRepository([run]));
    const mounted = start(run.detail.url);
    await screen.findByRole('heading', { name: publicSettings });
    expect(screen.getByRole('link', { name: 'BENCH' }).getAttribute('href')).toBe('/bench/');
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(3);
    expect(screen.getByText('Shadows quality code').nextElementSibling?.textContent).toBe('0');
    expect(screen.getByText('Automatic RAM Cleaner').nextElementSibling?.textContent).toBe('Off');
    expect(screen.queryByText('Clouds quality')).toBeNull();
    mounted.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: publicSettings });
    expect(window.location.pathname).toBe(run.detail.url);
  });
  it('shows empty results without substituting different hardware', async () => {
    start('/bench/?ram_gb=48');
    await screen.findByText('No matching runs');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByLabelText<HTMLSelectElement>('RAM').value).toBe('48');
  });
  it('handles removed runs and missing settings', async () => {
    start('/bench/runs/br_missing');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      screen.getByText('This public run is unavailable. It may have been removed.'),
    ).toBeTruthy();
    const run = createSyntheticRuns().find(item => item.detail.settings === null)!;
    act(() => navigate(run.detail.url));
    expect(await screen.findByText('No public settings recorded.')).toBeTruthy();
  });
  it('recovers from request failures and stale cursors', async () => {
    request.mockImplementationOnce(() => Promise.reject(new Error('network')));
    start('/bench/?cursor=cur_expired');
    expect(await screen.findByText('Unable to load benchmark data. Please retry.')).toBeTruthy();
    expect(
      await screen.findByText('This page link is no longer valid. Return to the first page.'),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>('CPU').disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Return to the first page' }));
    await results();
    expect(window.location.search).toBe('');
  });
  it('does not let a slow previous search overwrite newer results', async () => {
    const oldResponse = await app.request('/api/bench/v1/runs');
    let release: ((response: Response) => void) | undefined;
    request.mockImplementation((path: string) =>
      path === '/api/bench/v1/runs?'
        ? new Promise<Response>(resolve => {
            release = resolve;
          })
        : app.request(path),
    );
    start();
    await choose('RAM', '32');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await act(async () => {
      release?.(oldResponse);
      await Promise.resolve();
    });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('1 hardware configuration · 8 runs · 2 contributors')).toBeTruthy();
  });
  it('rejects invalid URL filters without issuing a search', async () => {
    start('/bench/?game_width=1920');
    expect(screen.getByRole('alert').textContent).toContain('invalid');
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.calls.every(([url]) => url.endsWith('filter-options'))).toBe(true);
  });
});
