import type { D1Database } from '@cloudflare/workers-types';

export interface AppBindings {
  BENCHMARK_CURSOR_SECRET?: string;
  BENCHMARK_DB?: D1Database;
  DISABLE_INDEXING?: string;
  APP_ORIGIN?: string;
  CLERK_ISSUER?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
}

export interface AuthConfig {
  origin: string;
  issuer: string;
  publishableKey: string;
  secretKey: string;
  jwtKey: string | undefined;
}

export interface AppConfig {
  database: D1Database | undefined;
  cursorSecret: string | undefined;
  disableIndexing: boolean;
  auth: AuthConfig | undefined;
}

declare module 'hono' {
  interface ContextVariableMap {
    config: AppConfig;
  }
}

export function readConfig(env: AppBindings = {}): AppConfig {
  const auth =
    env.APP_ORIGIN && env.CLERK_ISSUER && env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY
      ? {
          origin: env.APP_ORIGIN,
          issuer: env.CLERK_ISSUER,
          publishableKey: env.CLERK_PUBLISHABLE_KEY,
          secretKey: env.CLERK_SECRET_KEY,
          jwtKey: env.CLERK_JWT_KEY,
        }
      : undefined;

  return {
    cursorSecret: env.BENCHMARK_CURSOR_SECRET,
    database: env.BENCHMARK_DB,
    disableIndexing: env.DISABLE_INDEXING === 'true',
    auth,
  };
}
