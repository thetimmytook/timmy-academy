import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../index';

const stagingOrigin = 'https://staging.example';
const immutableCache = 'public, max-age=31536000, immutable';
const indexingHeader = 'X-Robots-Tag';
const cacheHeader = 'Cache-Control';
const cache = new Map<string, Response>();
const match = vi.fn((request: Request) => Promise.resolve(cache.get(request.url)?.clone()));
const put = vi.fn((request: Request, response: Response) => {
  cache.set(request.url, response.clone());

  return Promise.resolve();
});
const open = vi.fn().mockResolvedValue({ match, put });

beforeEach(() => {
  cache.clear();
  vi.clearAllMocks();
  vi.stubGlobal('caches', { open });
});

afterEach(() => vi.unstubAllGlobals());

async function discover(origin: string, key: string | undefined): Promise<Response> {
  return app.request(origin + '/api/config', {}, { CLERK_PUBLISHABLE_KEY: key });
}

describe('public runtime configuration', () => {
  it.each([
    { name: 'open', operation: open },
    { name: 'match', operation: match },
    { name: 'put', operation: put },
  ])('still serves valid configuration when cache $name fails', async ({ operation }) => {
    operation.mockRejectedValueOnce(new Error('cache unavailable'));
    const key = 'pk_test_cache_failure_fixture';
    const path = (await discover(stagingOrigin, key)).headers.get('Location')!;
    const response = await app.request(stagingOrigin + path, {}, { CLERK_PUBLISHABLE_KEY: key });
    expect(response.status).toBe(200);
    expect(response.headers.get(cacheHeader)).toBe(immutableCache);
    expect(await response.json()).toEqual({ clerkPublishableKey: key });
  });

  it('uses uncached discovery and caches only an explicit public allowlist', async () => {
    const bindings = {
      CLERK_PUBLISHABLE_KEY: 'pk_test_public_fixture',
      CLERK_SECRET_KEY: 'private_clerk_fixture',
      BENCHMARK_CURSOR_SECRET: 'private_cursor_fixture',
      APP_ORIGIN: stagingOrigin,
      CLERK_ISSUER: 'https://issuer.example',
      CLERK_DESKTOP_CLIENT_ID: 'private_to_this_endpoint',
      DISABLE_INDEXING: 'true',
    };
    const discovery = await app.request(stagingOrigin + '/api/config', {}, bindings);
    expect(discovery.status).toBe(302);
    expect(discovery.headers.get(cacheHeader)).toBe('no-store');
    expect(discovery.headers.get(indexingHeader)).toBe('noindex');
    expect(match).not.toHaveBeenCalled();
    const location = discovery.headers.get('Location')!;
    expect(location).toMatch(/^\/api\/config\?version=[a-f\d]{64}$/);

    const response = await app.request(stagingOrigin + location, {}, bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get(cacheHeader)).toBe(immutableCache);
    expect(response.headers.get(indexingHeader)).toBe('noindex');
    expect(await response.json()).toEqual({ clerkPublishableKey: bindings.CLERK_PUBLISHABLE_KEY });
    expect(put).toHaveBeenCalledOnce();

    const cached = await app.request(stagingOrigin + location, {}, bindings);
    expect(cached.headers.get(cacheHeader)).toBe(immutableCache);
    expect(cached.headers.get(indexingHeader)).toBe('noindex');
    expect(await cached.json()).toEqual({ clerkPublishableKey: bindings.CLERK_PUBLISHABLE_KEY });
    expect(put).toHaveBeenCalledOnce();
  });

  it('changes the URL on key rotation and redirects obsolete versions without caching', async () => {
    const origin = stagingOrigin;
    const old = (await discover(origin, 'pk_test_old')).headers.get('Location')!;
    await app.request(origin + old, {}, { CLERK_PUBLISHABLE_KEY: 'pk_test_old' });
    const current = (await discover(origin, 'pk_test_new')).headers.get('Location')!;
    expect(current).not.toBe(old);
    const stale = await app.request(origin + old, {}, { CLERK_PUBLISHABLE_KEY: 'pk_test_new' });
    expect(stale.status).toBe(302);
    expect(stale.headers.get('Location')).toBe(current);
    expect(stale.headers.get(cacheHeader)).toBe('no-store');
    expect(put).toHaveBeenCalledOnce();
  });

  it('isolates the edge cache by origin even when both environments have the same key', async () => {
    const key = 'pk_test_shared_fixture';

    for (const origin of [stagingOrigin, 'https://production.example']) {
      const path = (await discover(origin, key)).headers.get('Location')!;
      const response = await app.request(origin + path, {}, { CLERK_PUBLISHABLE_KEY: key });
      expect(response.status).toBe(200);
      expect(response.headers.has(indexingHeader)).toBe(false);
    }

    expect(cache.size).toBe(2);
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('supports anonymous clients and missing Clerk configuration without a database', async () => {
    const discovery = await discover('https://example.test', undefined);
    const response = await app.request(
      'https://example.test' + discovery.headers.get('Location')!,
      {
        headers: { Authorization: 'Bearer invalid' },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clerkPublishableKey: null });
  });
});
