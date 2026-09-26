import { moderationQuerySchema, moderationQueueSchema } from '@timmy/contracts';
import { Hono } from 'hono';

import { BenchmarkRequestError } from '../benchmark/repository';

import { D1ModerationRepository } from './d1-moderation-repository';

export function createAdminRouter(): Hono {
  const app = new Hono();
  app.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    const principal = await context.get('requirePrincipal')();

    if (!principal.canModerate || principal.session.kind !== 'browser') {
      throw new BenchmarkRequestError('forbidden');
    }

    await next();
  });
  app.get('/approvals', async context => {
    const params = new URL(context.req.url).searchParams;
    const query = moderationQuerySchema.safeParse(Object.fromEntries(params));

    if (!query.success || [...params.keys()].some(key => params.getAll(key).length !== 1)) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const { database } = context.get('config');

    if (!database) {
      throw new Error('Database is not configured.');
    }

    const page = await new D1ModerationRepository(database).pending(query.data);

    return context.json(moderationQueueSchema.parse(page));
  });

  return app;
}
