import { Hono } from 'hono';

export function createPublicConfigRouter(): Hono {
  const app = new Hono();

  app.get('/', async context => {
    context.header('Cache-Control', 'no-store');

    const config = context.get('config').publicConfig;
    const body = JSON.stringify(config);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const version = Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const path = '/api/config?version=' + version;

    // Discover the current version on every page load, including after key rotation.
    // An obsolete version must never cache a new key under its old immutable URL.
    if (context.req.query('version') !== version) {
      return context.redirect(path, 302);
    }

    // Include the origin in the edge cache key to isolate staging and production.
    const cacheKey = new Request(new URL(path, context.req.url));
    const response = context.json(config, 200, {
      'Cache-Control': 'public, max-age=31536000, immutable',
    });

    try {
      const cache = await caches.open('public-config');
      const cached = await cache.match(cacheKey);

      if (cached) {
        return cached;
      }

      await cache.put(cacheKey, response.clone());
    } catch {
      // Caching is optional; a cache failure must not make valid config unavailable.
    }

    return response;
  });

  return app;
}
