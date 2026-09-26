import {
  cohortQuerySchema,
  cohortResponseSchema,
  healthResponseSchema,
  filterOptionsSchema,
  publicRunIdSchema,
  publicRunDetailSchema,
  runSearchQuerySchema,
  runSearchResponseSchema,
} from '@timmy/contracts';

import { COHORT_QUERY_MAX_BODY_BYTES } from '../config';

import { readJsonBody } from './json-body';
import { BenchmarkRequestError } from './repository';

import type { BenchmarkRepository } from './repository';
import type { Context, Hono } from 'hono';

export function registerBenchmarkApi(
  app: Hono,
  resolve: (context: Context) => BenchmarkRepository,
): void {
  app.use('/api/bench/v1/*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    await next();
  });

  app.get('/api/bench/v1/health', context =>
    context.json(healthResponseSchema.parse({ status: 'ok' })),
  );

  app.get('/api/bench/v1/runs', async context => {
    const parameters = new URL(context.req.url).searchParams;

    if ([...parameters.keys()].some(key => parameters.getAll(key).length !== 1)) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const parsed = runSearchQuerySchema.safeParse(Object.fromEntries(parameters));

    if (!parsed.success) {
      throw new BenchmarkRequestError('invalid_input');
    }

    return context.json(runSearchResponseSchema.parse(await resolve(context).search(parsed.data)));
  });

  app.get('/api/bench/v1/filter-options', async context => {
    if (new URL(context.req.url).search) {
      throw new BenchmarkRequestError('invalid_input');
    }

    return context.json(filterOptionsSchema.parse(await resolve(context).filterOptions()));
  });

  app.get('/api/bench/v1/runs/:publicRunId', async context => {
    if (new URL(context.req.url).search) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const parsed = publicRunIdSchema.safeParse(context.req.param('publicRunId'));

    if (!parsed.success) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const detail = await resolve(context).detail(parsed.data);

    if (!detail) {
      throw new BenchmarkRequestError('not_found');
    }

    return context.json(publicRunDetailSchema.parse(detail));
  });

  app.post('/api/bench/v1/cohorts/query', async context => {
    if (new URL(context.req.url).search) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const body = await readJsonBody(context.req.raw, COHORT_QUERY_MAX_BODY_BYTES);

    const parsed = cohortQuerySchema.safeParse(body);

    if (!parsed.success) {
      throw new BenchmarkRequestError('invalid_input');
    }

    return context.json(cohortResponseSchema.parse(await resolve(context).cohort(parsed.data)));
  });
}
