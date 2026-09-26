import { benchmarkErrorSchema } from '@timmy/contracts';
import { Hono } from 'hono';

import { createAdminRouter } from './admin/admin.api';
import { AuthenticationDenied } from './auth/application-principal';
import { requestPrincipal } from './auth/request-principal';
import { registerBenchmarkApi } from './benchmark/benchmark.api';
import { D1BenchmarkRepository } from './benchmark/d1-repository';
import { createOwnerRunsRouter } from './benchmark/owner-runs.api';
import { BenchmarkRequestError, type BenchmarkRepository } from './benchmark/repository';
import { readConfig } from './read-config';

import type { AppBindings } from './config-types';

export function createApp(repository?: BenchmarkRepository): Hono {
  const app = new Hono();
  app.use('*', async (context, next) => {
    const config = readConfig(context.env as AppBindings | undefined);
    context.set('config', config);
    await next();

    if (config.disableIndexing) {
      context.header('X-Robots-Tag', 'noindex');
    }
  });
  app.use('/api/*', requestPrincipal());
  app.route('/api/bench/v1/me', createOwnerRunsRouter());
  app.route('/api/admin/v1', createAdminRouter());
  registerBenchmarkApi(
    app,
    repository
      ? (): BenchmarkRepository => repository
      : (context): BenchmarkRepository => {
          const { database, cursorSecret } = context.get('config');

          if (!database) {
            throw new Error('Database is not configured.');
          }

          return new D1BenchmarkRepository(database, cursorSecret);
        },
  );

  app.notFound(context =>
    context.json(
      benchmarkErrorSchema.parse({
        code: 'not_found',
        message: 'The resource was not found.',
        request_id: `req_${crypto.randomUUID()}`,
      }),
      404,
    ),
  );

  app.onError((error, context) => {
    if (error instanceof AuthenticationDenied) {
      context.header('Cache-Control', 'no-store');

      return context.json(
        benchmarkErrorSchema.parse({
          code: 'authentication_required',
          message: 'Authentication required.',
          request_id: `req_${crypto.randomUUID()}`,
        }),
        401,
      );
    }

    const known = error instanceof BenchmarkRequestError;

    return context.json(
      benchmarkErrorSchema.parse({
        code: known ? error.code : 'internal_error',
        message: known ? error.message : 'The benchmark request could not be completed.',
        request_id: `req_${crypto.randomUUID()}`,
      }),
      known ? error.status : 500,
    );
  });

  return app;
}

export default createApp();
