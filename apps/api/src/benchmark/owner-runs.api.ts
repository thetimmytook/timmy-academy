import {
  clientRunIdSchema,
  deletePublicationResponseSchema,
  publicRunIdSchema,
  submissionRequestSchema,
  submissionResponseSchema,
  ownerRunLookupSchema,
  ownerRunsQuerySchema,
  ownerRunsResponseSchema,
} from '@timmy/contracts';
import { Hono } from 'hono';

import { SUBMISSION_MAX_BODY_BYTES } from '../config';

import { D1SubmissionDeletion } from './d1-submission-deletion';
import { D1SubmissionRepository } from './d1-submission-repository';
import { D1SubmissionWriter } from './d1-submission-writer';
import { readJsonBody } from './json-body';
import { OwnerSubmissionReader } from './owner-submission-reader';
import { BenchmarkRequestError } from './repository';
import { submissionFingerprint } from './submission-fingerprint';
import { normalizeSubmission } from './submission-normalization';

import type { OwnerSubmission, DeletedSubmission } from './d1-submission-repository';
import type { ApplicationPrincipal } from '../auth/application-principal';
import type { D1Database } from '@cloudflare/workers-types';
import type { Context } from 'hono';

type OwnerEnv = { Variables: { principal: ApplicationPrincipal } };

function database(context: Context): D1Database {
  const { database } = context.get('config');

  if (!database) {
    throw new Error('Database is not configured.');
  }

  return database;
}

// Until detailed reasons are agreed, expose only a generic code, never stored review text.
function ownerItem(item: OwnerSubmission | DeletedSubmission): OwnerSubmission | DeletedSubmission {
  return item.publication_status === 'rejected' ? { ...item, status_reason: 'rejected' } : item;
}

export function createOwnerRunsRouter(): Hono<OwnerEnv> {
  const app = new Hono<OwnerEnv>();
  app.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.set('principal', await context.get('requirePrincipal')());
    await next();
  });

  app.post('/runs', async context => {
    if (new URL(context.req.url).search) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const body = await readJsonBody(context.req.raw, SUBMISSION_MAX_BODY_BYTES);
    const parsed = submissionRequestSchema.safeParse(body);

    if (!parsed.success) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const data = await normalizeSubmission(parsed.data);
    const fingerprint = await submissionFingerprint(parsed.data);
    const receipt = await new D1SubmissionWriter(database(context)).submit(
      context.get('principal').accountId,
      parsed.data.client_run_id,
      data,
      fingerprint,
    );

    return context.json(
      submissionResponseSchema.parse(receipt),
      receipt.publication_status === 'published' ? 200 : 202,
    );
  });

  app.delete('/runs/:publicRunId', async context => {
    const parsed = publicRunIdSchema.safeParse(context.req.param('publicRunId'));

    if (!parsed.success || new URL(context.req.url).search || context.req.raw.body !== null) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const receipt = await new D1SubmissionDeletion(database(context)).delete(
      context.get('principal').accountId,
      parsed.data,
    );

    return context.json(deletePublicationResponseSchema.parse(receipt));
  });

  app.get('/runs', async context => {
    const principal = context.get('principal');
    const parameters = new URL(context.req.url).searchParams;

    if ([...parameters.keys()].some(key => parameters.getAll(key).length !== 1)) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const parsed = ownerRunsQuerySchema.safeParse(Object.fromEntries(parameters));

    if (!parsed.success) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const { cursorSecret } = context.get('config');

    if (!cursorSecret) {
      throw new Error('Benchmark cursor signing key is not configured.');
    }

    const page = await new OwnerSubmissionReader(
      new D1SubmissionRepository(database(context)),
      cursorSecret,
    ).list(principal.accountId, parsed.data);

    return context.json(
      ownerRunsResponseSchema.parse({
        status_filter: parsed.data.status,
        limit: parsed.data.limit,
        items: page.items.map(ownerItem),
        next_cursor: page.next_cursor,
      }),
    );
  });

  app.get('/runs/by-client-id/:clientRunId', async context => {
    const principal = context.get('principal');
    const parsed = clientRunIdSchema.safeParse(context.req.param('clientRunId'));

    if (!parsed.success || new URL(context.req.url).search) {
      throw new BenchmarkRequestError('invalid_input');
    }

    const item = await new D1SubmissionRepository(database(context)).findByClientId(
      principal.accountId,
      parsed.data,
    );

    if (!item) {
      throw new BenchmarkRequestError('not_found');
    }

    return context.json(ownerRunLookupSchema.parse({ item: ownerItem(item) }));
  });

  return app;
}
