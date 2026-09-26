import { BenchmarkRequestError } from '../benchmark/repository';
import { AUTH_RATE_LIMIT_RETRY_SECONDS } from '../config';

import { AuthenticationDenied } from './application-principal';
import { createClerkBrowserAdapter } from './clerk-browser-adapter';
import { createClerkDesktopAdapter } from './clerk-desktop-adapter';
import { D1AccountRepository } from './d1-account-repository';

import type { ApplicationPrincipal } from './application-principal';
import type { Context, MiddlewareHandler } from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    requirePrincipal: () => Promise<ApplicationPrincipal>;
  }
}

export function requestPrincipal(): MiddlewareHandler {
  return async (context, next): Promise<void> => {
    let principal: Promise<ApplicationPrincipal> | undefined;
    context.set('requirePrincipal', () => {
      context.header('Cache-Control', 'no-store');
      principal ??= authenticate(context);

      return principal;
    });
    await next();
  };
}

async function authenticate(context: Context): Promise<ApplicationPrincipal> {
  const { auth, database, authRateLimit } = context.get('config');

  if (!auth) {
    throw new Error('Authentication is not configured.');
  }

  if (!database) {
    throw new Error('Database is not configured.');
  }

  if (!authRateLimit) {
    throw new Error('Authentication rate limiting is not configured.');
  }

  // Cloudflare supplies this header. Do not trust X-Forwarded-For or token contents.
  // Requests without it (for example local development) share one fallback bucket.
  const { success } = await authRateLimit.limit({
    key: context.req.header('CF-Connecting-IP') ?? 'unknown',
  });

  if (!success) {
    throw new BenchmarkRequestError('rate_limited', AUTH_RATE_LIMIT_RETRY_SECONDS);
  }

  const accounts = new D1AccountRepository(database);
  const request = context.req.raw;
  const authorization = request.headers.get('Authorization');

  if (authorization !== null) {
    const match = /^Bearer ([a-z0-9._~+/-]+=*)$/i.exec(authorization);
    const token = match?.[1];

    if (!token || token.length > 4096) {
      throw new AuthenticationDenied();
    }

    // The deployed desktop client issues opaque tokens. JWTs remain browser-only.
    // Shape selects a verifier; only the verifier can establish an identity.
    if (!token.includes('.')) {
      const origin = request.headers.get('Origin');

      if (origin !== null && origin !== auth.origin) {
        throw new AuthenticationDenied();
      }

      return createClerkDesktopAdapter(auth, accounts).authenticate(token);
    }

    // An explicit bearer must never silently fall back to a browser cookie.
    const headers = new Headers(request.headers);
    headers.delete('Cookie');

    return createClerkBrowserAdapter(auth, accounts).authenticate(
      new Request(request.url, { method: request.method, headers }),
    );
  }

  return createClerkBrowserAdapter(auth, accounts).authenticate(request);
}
