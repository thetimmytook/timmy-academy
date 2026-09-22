import { benchmarkErrorSchema } from '@timmy/contracts';
import { Hono } from 'hono';

import { registerBenchmarkApi } from './benchmark/benchmark.api';
import { D1BenchmarkRepository } from './benchmark/d1-repository';
import { BenchmarkRequestError, type BenchmarkRepository } from './benchmark/repository';

import type { D1Database } from '@cloudflare/workers-types';

export function createApp(repository?: BenchmarkRepository): Hono {
  const app = new Hono();
  app.use('*', async (context, next) => {
    await next();
    const bindings = context.env as { DISABLE_INDEXING?: string } | undefined;

    if (bindings?.DISABLE_INDEXING === 'true') {
      context.header('X-Robots-Tag', 'noindex');
    }
  });
  registerBenchmarkApi(
    app,
    repository
      ? (): BenchmarkRepository => repository
      : (context): BenchmarkRepository =>
          new D1BenchmarkRepository((context.env as { BENCHMARK_DB: D1Database }).BENCHMARK_DB),
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
