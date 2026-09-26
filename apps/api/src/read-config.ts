import type { AppBindings, AppConfig } from './config-types';

export function readConfig(env: AppBindings = {}): AppConfig {
  const auth =
    env.APP_ORIGIN && env.CLERK_ISSUER && env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY
      ? {
          origin: env.APP_ORIGIN,
          issuer: env.CLERK_ISSUER,
          publishableKey: env.CLERK_PUBLISHABLE_KEY,
          secretKey: env.CLERK_SECRET_KEY,
          jwtKey: env.CLERK_JWT_KEY,
          desktopClientId: env.CLERK_DESKTOP_CLIENT_ID,
        }
      : undefined;

  return {
    authRateLimit: env.AUTH_RATE_LIMIT,
    cursorSecret: env.BENCHMARK_CURSOR_SECRET,
    database: env.BENCHMARK_DB,
    disableIndexing: env.DISABLE_INDEXING === 'true',
    auth,
  };
}
