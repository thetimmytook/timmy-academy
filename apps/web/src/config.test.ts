import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { loadConfig } from './config';

const fetchConfig = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchConfig.mockReset();
  vi.stubGlobal('fetch', fetchConfig);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('loads configuration from the same origin without sending credentials', async () => {
  fetchConfig.mockResolvedValue(Response.json({ clerkPublishableKey: 'pk_live_fixture' }));
  expect(await loadConfig()).toEqual({ clerkPublishableKey: 'pk_live_fixture' });
  expect(fetchConfig).toHaveBeenCalledExactlyOnceWith('/api/config', {
    credentials: 'omit',
    mode: 'same-origin',
    signal: fetchConfig.mock.calls[0]?.[1]?.signal,
  });
  expect(fetchConfig.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
});

it.each([
  new Response(null, { status: 503 }),
  new Response('invalid JSON'),
  Response.json({ clerkPublishableKey: '' }),
  Response.json({ clerkPublishableKey: 'pk_test_fixture', unexpected: 'private' }),
  Response.json({}),
])('disables sign-in when the response is unavailable or invalid: %#', async response => {
  fetchConfig.mockResolvedValue(response);
  expect(await loadConfig()).toEqual({ clerkPublishableKey: null });
});

it('disables sign-in when fetching configuration fails', async () => {
  fetchConfig.mockRejectedValue(new Error('network unavailable'));
  expect(await loadConfig()).toEqual({ clerkPublishableKey: null });
});

it('bounds waiting for configuration to five seconds', async () => {
  vi.useFakeTimers();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), milliseconds);

    return controller.signal;
  });
  fetchConfig.mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
      }),
  );
  const config = loadConfig();
  await vi.advanceTimersByTimeAsync(5000);
  expect(await config).toEqual({ clerkPublishableKey: null });
  expect(timeout).toHaveBeenCalledExactlyOnceWith(5000);
});
