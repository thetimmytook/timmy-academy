import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryBenchmarkRepository } from '../benchmark/in-memory-repository';
import { createApp } from '../index';

import { AuthenticationDenied } from './application-principal';
import { createClerkBrowserAdapter } from './clerk-browser-adapter';

import type { ApplicationPrincipal } from './application-principal';

vi.mock('./clerk-browser-adapter', () => ({ createClerkBrowserAdapter: vi.fn() }));

const authenticate = vi.fn<(request: Request) => Promise<ApplicationPrincipal>>();
const config = {
  // This suite stubs authentication; no D1 operation is performed.
  BENCHMARK_DB: {} as D1Database,
  APP_ORIGIN: 'https://timmy.example',
  CLERK_ISSUER: 'https://browser.clerk.accounts.dev',
  CLERK_PUBLISHABLE_KEY: 'pk_test_fixture',
  CLERK_SECRET_KEY: 'sk_test_fixture',
};
const principal: ApplicationPrincipal = {
  accountId: 'private_account',
  emailVerified: true,
  session: { kind: 'browser', expiresAt: Date.now() + 60_000 },
};
const privatePath = '/api/test-private';

beforeEach(() => {
  vi.mocked(createClerkBrowserAdapter).mockReset().mockReturnValue({ authenticate });
  authenticate.mockReset().mockResolvedValue(principal);
});

describe('browser auth in the product API', () => {
  it('keeps public benchmark requests anonymous even with invalid credentials and no auth config', async () => {
    const app = createApp(new InMemoryBenchmarkRepository());
    const response = await app.request('/api/bench/v1/runs', {
      headers: { Authorization: 'Bearer invalid' },
    });
    expect(response.status).toBe(200);
    expect(createClerkBrowserAdapter).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('accountId');
  });

  it('resolves once within a request, then authenticates again on the next request', async () => {
    const app = createApp();
    app.get(privatePath, async context => {
      const [first, second] = await Promise.all([
        context.get('requirePrincipal')(),
        context.get('requirePrincipal')(),
      ]);
      expect(first).toBe(second);
      expect(first).toEqual(principal);

      return context.json({ status: 'ok' });
    });
    const first = await app.request(privatePath, {}, config);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'ok' });
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(authenticate).toHaveBeenCalledOnce();
    expect((await app.request(privatePath, {}, config)).status).toBe(200);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it.each([
    { error: new AuthenticationDenied(), status: 401, code: 'authentication_required' },
    { error: new Error('private D1 details'), status: 500, code: 'internal_error' },
  ])('returns sanitized $status for a protected request', async ({ error, status, code }) => {
    authenticate.mockRejectedValue(error);
    const app = createApp();
    app.get(privatePath, async context => {
      await context.get('requirePrincipal')();

      return context.json({ status: 'ok' });
    });
    const response = await app.request(privatePath, {}, config);
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body: unknown = await response.json();
    expect(body).toMatchObject({ code });
    expect(JSON.stringify(body)).not.toContain('private');
  });

  it.each([{}, { ...config, CLERK_SECRET_KEY: '' }, { ...config, CLERK_ISSUER: undefined }])(
    'reports missing auth configuration only when a handler requires authentication',
    async bindings => {
      const app = createApp();
      app.get(privatePath, async context => {
        await context.get('requirePrincipal')();

        return context.json({ status: 'ok' });
      });
      const response = await app.request(privatePath, {}, bindings);
      expect(response.status).toBe(500);
      expect(createClerkBrowserAdapter).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain('CLERK');
    },
  );

  it('does not register test or PoC auth routes in the product app', async () => {
    const app = createApp();
    expect((await app.request(privatePath)).status).toBe(404);
    expect((await app.request('/api/auth/v1/poc/check')).status).toBe(404);
  });
});
