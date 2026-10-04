import type { D1Database, RateLimit } from '@cloudflare/workers-types';
import type { PublicConfig } from '@timmy/contracts';

export interface AppBindings {
  AUTH_RATE_LIMIT?: RateLimit;
  BENCHMARK_CURSOR_SECRET?: string;
  BENCHMARK_DB?: D1Database;
  DISABLE_INDEXING?: string;
  APP_ORIGIN?: string;
  CLERK_ISSUER?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
  CLERK_DESKTOP_CLIENT_ID?: string;
}

export interface AuthConfig {
  origin: string;
  issuer: string;
  publishableKey: string;
  secretKey: string;
  jwtKey: string | undefined;
  desktopClientId?: string | undefined;
}

export interface AppConfig {
  publicConfig: PublicConfig;
  authRateLimit: RateLimit | undefined;
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
