import {
  moderationQuerySchema,
  moderationQueueSchema,
  moderationDecisionSchema,
  moderationDecisionResponseSchema,
} from '@timmy/contracts';
import { Hono } from 'hono';
import { z } from 'zod';

import { D1SubmissionApproval } from '../benchmark/d1-submission-approval';
import { D1SubmissionRejection } from '../benchmark/d1-submission-rejection';
import { BenchmarkRequestError } from '../benchmark/repository';

import { D1ModerationRepository } from './d1-moderation-repository';

const decisionParamsSchema = z.strictObject({
  submissionId: z.coerce.number().int().positive(),
  decision: moderationDecisionSchema,
});

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

  app.post('/approvals/:submissionId/:decision', async context => {
    const parsed = decisionParamsSchema.safeParse(context.req.param());

    if (!parsed.success || new URL(context.req.url).search) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const { database } = context.get('config');

    if (!database) {
      throw new Error('Database is not configured.');
    }

    const { submissionId, decision } = parsed.data;
    const result =
      decision === 'approve'
        ? await new D1SubmissionApproval(database).approve(submissionId)
        : await new D1SubmissionRejection(database).reject(submissionId);

    if (!result) {
      throw new BenchmarkRequestError('not_found');
    }

    return context.json(
      moderationDecisionResponseSchema.parse({
        submission_id: submissionId,
        publication_status: decision === 'approve' ? 'published' : 'rejected',
      }),
    );
  });

  return app;
}
