import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryBenchmarkRepository } from '../benchmark/in-memory-repository';
import { createApp } from '../index';

import { AuthenticationDenied } from './application-principal';
import { createClerkBrowserAdapter } from './clerk-browser-adapter';
import { createClerkDesktopAdapter } from './clerk-desktop-adapter';

import type { ApplicationPrincipal } from './application-principal';

vi.mock('./clerk-browser-adapter', () => ({ createClerkBrowserAdapter: vi.fn() }));
vi.mock('./clerk-desktop-adapter', () => ({ createClerkDesktopAdapter: vi.fn() }));

const authenticate = vi.fn<(request: Request) => Promise<ApplicationPrincipal>>();
const authenticateDesktop = vi.fn<(token: string) => Promise<ApplicationPrincipal>>();
const config = {
  // This suite stubs authentication; no D1 operation is performed.
  BENCHMARK_DB: {} as D1Database,
  APP_ORIGIN: 'https://timmy.example',
  CLERK_ISSUER: 'https://browser.clerk.accounts.dev',
  CLERK_PUBLISHABLE_KEY: 'pk_test_fixture',
  CLERK_SECRET_KEY: 'sk_test_fixture',
  AUTH_RATE_LIMIT: { limit: vi.fn().mockResolvedValue({ success: true }) },
  CLERK_DESKTOP_CLIENT_ID: 'desktop_fixture',
};
const principal: ApplicationPrincipal = {
  accountId: 'private_account',
  emailVerified: true,
  canModerate: false,
  session: { kind: 'browser', expiresAt: Date.now() + 60_000 },
};
const ownerPath = '/api/bench/v1/me/runs';
const desktopAuthorization = 'Bearer opaque-fixture';
const browserAuthorization = 'Bearer browser.jwt.fixture';
const browserCookie = '__session=browser-fixture';
const privatePath = '/api/test-private';
const cacheControl = 'Cache-Control';

beforeEach(() => {
  vi.mocked(createClerkBrowserAdapter).mockReset().mockReturnValue({ authenticate });
  authenticate.mockReset().mockResolvedValue(principal);
  vi.mocked(createClerkDesktopAdapter)
    .mockReset()
    .mockReturnValue({ authenticate: authenticateDesktop });
  authenticateDesktop
    .mockReset()
    .mockResolvedValue({ ...principal, session: { ...principal.session, kind: 'desktop' } });
});

describe('request auth in the product API', () => {
  it.each([desktopAuthorization, browserAuthorization])(
    'limits auth before contacting Clerk for %s',
    async authorization => {
      const limit = vi.fn().mockResolvedValue({ success: false });
      const response = await createApp().request(
        ownerPath,
        {
          headers: {
            Authorization: authorization,
            'CF-Connecting-IP': '192.0.2.1',
            'X-Forwarded-For': '192.0.2.99',
          },
        },
        { ...config, AUTH_RATE_LIMIT: { limit } },
      );
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('60');
      expect(response.headers.get(cacheControl)).toBe('no-store');
      expect(await response.json()).toMatchObject({
        code: 'rate_limited',
        retry_after_seconds: 60,
      });
      expect(limit).toHaveBeenCalledExactlyOnceWith({ key: '192.0.2.1' });
      expect(createClerkBrowserAdapter).not.toHaveBeenCalled();
      expect(createClerkDesktopAdapter).not.toHaveBeenCalled();
    },
  );
  it('does not spend auth rate limits on public requests', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const response = await createApp(new InMemoryBenchmarkRepository()).request(
      '/api/bench/v1/runs',
      {},
      { ...config, AUTH_RATE_LIMIT: { limit } },
    );
    expect(response.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
  });
  it('fails closed when the auth rate limiter is missing or unavailable', async () => {
    for (const binding of [
      undefined,
      { limit: vi.fn().mockRejectedValue(new Error('binding failed')) },
    ]) {
      const response = await createApp().request(
        ownerPath,
        {},
        { ...config, AUTH_RATE_LIMIT: binding },
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: 'internal_error' });
    }

    expect(createClerkBrowserAdapter).not.toHaveBeenCalled();
    expect(createClerkDesktopAdapter).not.toHaveBeenCalled();
  });
  it('preserves the request body for browser-authenticated submission handlers', async () => {
    const app = createApp();
    app.post(privatePath, async context => {
      await context.get('requirePrincipal')();

      return context.text(await context.req.text());
    });
    const response = await app.request(
      privatePath,
      {
        method: 'POST',
        headers: { Authorization: browserAuthorization, Origin: config.APP_ORIGIN },
        body: 'submission body',
      },
      config,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('submission body');
  });

  it('allows desktop POST to reach the existing submission validator without browser Origin', async () => {
    const response = await createApp().request(
      ownerPath,
      {
        method: 'POST',
        headers: { Authorization: desktopAuthorization, 'Content-Type': 'application/json' },
        body: '{}',
      },
      config,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'invalid_input' });
    expect(authenticateDesktop).toHaveBeenCalledOnce();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('uses desktop credentials without Origin and never falls back to browser cookies', async () => {
    authenticateDesktop.mockRejectedValue(new AuthenticationDenied());
    const response = await createApp().request(
      ownerPath,
      {
        method: 'POST',
        headers: { Authorization: desktopAuthorization, Cookie: browserCookie },
      },
      config,
    );
    expect(response.status).toBe(401);
    expect(authenticateDesktop).toHaveBeenCalledExactlyOnceWith('opaque-fixture');
    expect(createClerkDesktopAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ desktopClientId: config.CLERK_DESKTOP_CLIENT_ID }),
      expect.anything(),
    );
    expect(authenticate).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('fixture');
  });

  it('rejects desktop access to the real Admin routes even for an admin account', async () => {
    authenticateDesktop.mockResolvedValue({
      ...principal,
      canModerate: true,
      session: { ...principal.session, kind: 'desktop' },
    });
    const response = await createApp().request(
      '/api/admin/v1/approvals',
      {
        headers: { Authorization: desktopAuthorization },
      },
      config,
    );
    expect(response.status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it.each(['', 'Basic fixture', 'Bearer ', 'Bearer first second', 'Bearer first,Bearer second'])(
    'does not fall back to cookies on malformed Authorization: %s',
    async authorization => {
      const response = await createApp().request(
        ownerPath,
        {
          headers: { Authorization: authorization, Cookie: browserCookie },
        },
        config,
      );
      expect(response.status).toBe(401);
      expect(authenticate).not.toHaveBeenCalled();
      expect(authenticateDesktop).not.toHaveBeenCalled();
    },
  );

  it('rejects a foreign Origin for desktop credentials', async () => {
    const response = await createApp().request(
      ownerPath,
      {
        headers: { Authorization: desktopAuthorization, Origin: 'https://foreign.example' },
      },
      config,
    );
    expect(response.status).toBe(401);
    expect(authenticateDesktop).not.toHaveBeenCalled();
  });

  it('keeps browser JWT verification and removes cookies when a bearer is explicit', async () => {
    authenticate.mockRejectedValue(new AuthenticationDenied());
    const response = await createApp().request(
      ownerPath,
      {
        headers: {
          Authorization: browserAuthorization,
          Cookie: browserCookie,
        },
      },
      config,
    );
    expect(response.status).toBe(401);
    expect(authenticate.mock.calls[0]?.[0].headers.get('Cookie')).toBeNull();
    expect(authenticate.mock.calls[0]?.[0].headers.get('Authorization')).toBe(browserAuthorization);
    expect(authenticateDesktop).not.toHaveBeenCalled();
  });
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
    const limit = vi.fn().mockResolvedValue({ success: true });
    const bindings = { ...config, AUTH_RATE_LIMIT: { limit } };
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
    const first = await app.request(privatePath, {}, bindings);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'ok' });
    expect(first.headers.get(cacheControl)).toBe('no-store');
    expect(authenticate).toHaveBeenCalledOnce();
    expect(limit).toHaveBeenCalledExactlyOnceWith({ key: 'unknown' });
    expect((await app.request(privatePath, {}, bindings)).status).toBe(200);
    expect(limit).toHaveBeenCalledTimes(2);
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
    expect(response.headers.get(cacheControl)).toBe('no-store');
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
