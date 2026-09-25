import { clientRunIdSchema, publicRunDetailSchema } from '@timmy/contracts';
import { and, eq, notExists, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { runs, submissions } from '../db/schema';

import { BenchmarkRequestError } from './repository';

import type { D1Database } from '@cloudflare/workers-types';
import type { PublicRunDetail } from '@timmy/contracts';

// Internal storage input after normalization and capture validation; not an HTTP payload.
const submissionDataSchema = publicRunDetailSchema.omit({ public_run_id: true, url: true });
export type SubmissionData = Omit<PublicRunDetail, 'public_run_id' | 'url'>;
export interface SubmissionReceipt {
  client_run_id: string;
  publication_status: 'pending_review';
  public_run_id: null;
  url: null;
}
export class D1SubmissionWriter {
  private readonly db;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async submit(
    accountId: string,
    clientRunId: string,
    data: SubmissionData,
  ): Promise<SubmissionReceipt> {
    const clientId = clientRunIdSchema.parse(clientRunId);

    // Strict schemas rebuild nested objects in schema order, so JSON key order is irrelevant.
    const normalized = submissionDataSchema.parse(data);
    const publicId = 'br_' + crypto.randomUUID();
    const detail = publicRunDetailSchema.parse({
      ...normalized,
      public_run_id: publicId,
      url: '/bench/runs/' + publicId,
    });
    const submittedAt = new Date().toISOString();

    // D1 batch is one transaction on the primary. Only the winning request inserts
    // a run; any failed submission insert rolls it back. Never ignore a conflict.
    const existingSubmission = this.db
      .select({ sequence: submissions.sequence })
      .from(submissions)
      .where(and(eq(submissions.accountId, accountId), eq(submissions.clientRunId, clientId)));
    const [, , result] = await this.db.batch([
      // SELECT lists follow writable schema columns; generated search columns are omitted.
      this.db.insert(runs)
        .select(sql`SELECT NULL, ${publicId}, ${accountId}, NULL, 'hidden', ${JSON.stringify(detail)}
        WHERE ${notExists(existingSubmission)}`),
      this.db.insert(submissions)
        .select(sql`SELECT NULL, ${accountId}, ${clientId}, ${submittedAt}, 'pending_review', ${runs.sequence}, NULL
        FROM ${runs} WHERE ${and(eq(runs.publicId, publicId), notExists(existingSubmission))}`),
      this.db
        .select({
          status: submissions.status,
          detail: runs.detail,
          publicId: runs.publicId,
          visibility: runs.visibility,
        })
        .from(submissions)
        .leftJoin(runs, eq(runs.sequence, submissions.runSequence))
        .where(and(eq(submissions.accountId, accountId), eq(submissions.clientRunId, clientId))),
    ]);
    const stored = result[0];

    if (!stored) {
      throw new Error('Submission is missing after its transaction.');
    }

    if (stored.status !== 'pending_review') {
      throw new Error('Only pending submissions are supported by this writer.');
    }

    if (stored.detail === null) {
      throw new Error('Submission run is missing.');
    }

    const existing = publicRunDetailSchema.parse(JSON.parse(stored.detail));
    const existingId = existing.public_run_id;
    const existingData = submissionDataSchema.strip().parse(existing);

    if (JSON.stringify(existingData) !== JSON.stringify(normalized)) {
      throw new BenchmarkRequestError('idempotency_conflict');
    }

    if (stored.publicId !== existingId || stored.visibility !== 'hidden') {
      throw new Error('Submission publication state is inconsistent.');
    }

    return {
      client_run_id: clientId,
      publication_status: stored.status,
      public_run_id: null,
      url: null,
    };
  }
}
