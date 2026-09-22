import type { AuthAdapter } from './auth-adapter';
import type { Hono } from 'hono';

/** Only a separately assembled test app may register this route. */
export function registerAuthPocApi(app: Hono, adapter: AuthAdapter): void {
  app.get('/api/auth/v1/poc/check', async context => {
    context.header('Cache-Control', 'no-store');
    context.header('X-Robots-Tag', 'noindex');

    // Prevent credentials being supplied in URLs, including query and fragment.
    const url = new URL(context.req.url);

    if (url.search || url.hash) {
      return context.json({ status: 'denied' }, 400);
    }

    try {
      await adapter.authenticate(context.req.header('Authorization'));

      return context.json({ status: 'verified' });
    } catch {
      return context.json({ status: 'denied' }, 401);
    }
  });
}
