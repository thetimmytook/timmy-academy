import { createClerkBrowserAdapter } from './clerk-browser-adapter';
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
  const { auth, database } = context.get('config');

  if (!auth) {
    throw new Error('Browser authentication is not configured.');
  }

  if (!database) {
    throw new Error('Database is not configured.');
  }

  const adapter = createClerkBrowserAdapter(auth, new D1AccountRepository(database));

  return adapter.authenticate(context.req.raw);
}
