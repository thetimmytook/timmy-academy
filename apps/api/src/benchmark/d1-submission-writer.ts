import { clientRunIdSchema, publicRunDetailSchema } from '@timmy/contracts';
import { and, desc, eq, gt, notExists, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { SUBMISSION_ACCOUNT_LIMIT, SUBMISSION_QUOTA_WINDOW_MS } from '../config';
import { runs, submissions } from '../db/schema';

import { BenchmarkRequestError } from './repository';

import type { D1Database } from '@cloudflare/workers-types';
import type { PublicRunDetail, SubmissionResponse } from '@timmy/contracts';

// Internal storage input after normalization and capture validation; not an HTTP payload.
const submissionDataSchema = publicRunDetailSchema.omit({
  public_run_id: true,
  url: true,
  is_synthetic: true,
});
export type SubmissionData = Omit<PublicRunDetail, 'public_run_id' | 'url' | 'is_synthetic'>;
export class D1SubmissionWriter {
  private readonly db;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async submit(
    accountId: string,
    clientRunId: string,
    data: SubmissionData,
    requestFingerprint: string,
  ): Promise<SubmissionResponse> {
    const clientId = clientRunIdSchema.parse(clientRunId);

    // Strict schemas rebuild nested objects in schema order, so JSON key order is irrelevant.
    const normalized = submissionDataSchema.parse(data);
    const publicId = 'br_' + crypto.randomUUID();
    const detail = publicRunDetailSchema.parse({
      ...normalized,
      is_synthetic: false,
      public_run_id: publicId,
      url: '/bench/runs/' + publicId,
    });
    const now = Date.now();
    const submittedAt = new Date(now).toISOString();

    // D1 batch is one transaction on the primary. Only the winning request inserts
    // a run; any failed submission insert rolls it back. Never ignore a conflict.
    const existingSubmission = this.db
      .select({ sequence: submissions.sequence })
      .from(submissions)
      .where(and(eq(submissions.accountId, accountId), eq(submissions.clientRunId, clientId)));

    // Stored details have canonical schema order. Compare the measurement without
    // publication metadata, so a new client UUID or app version cannot duplicate it.
    // Reading existing details also covers submissions created before this check.
    const duplicate = this.db
      .select({ sequence: submissions.sequence })
      .from(submissions)
      .innerJoin(runs, eq(runs.sequence, submissions.runSequence))
      .where(
        and(
          eq(submissions.accountId, accountId),
          sql`json_remove(${runs.detail}, '$.public_run_id', '$.url', '$.is_synthetic', '$.hardware.cpu.name', '$.hardware.gpu.name', '$.resource_telemetry') = json_remove(${JSON.stringify(normalized)}, '$.hardware.cpu.name', '$.hardware.gpu.name', '$.resource_telemetry')`,
        ),
      )
      .limit(1);

    // The 50th most recent accepted submission determines when another slot opens.
    // Deleted markers still count, so deletion cannot reset the quota.
    const exhaustedQuota = this.db
      .select({ submittedAt: submissions.submittedAt })
      .from(submissions)
      .where(
        and(
          eq(submissions.accountId, accountId),
          gt(submissions.submittedAt, new Date(now - SUBMISSION_QUOTA_WINDOW_MS).toISOString()),
        ),
      )
      .orderBy(desc(submissions.submittedAt))
      .limit(1)
      .offset(SUBMISSION_ACCOUNT_LIMIT - 1);
    const [quota, , , result, duplicates] = await this.db.batch([
      exhaustedQuota,

      // SELECT lists follow writable schema columns; generated search columns are omitted.
      this.db.insert(runs)
        .select(sql`SELECT NULL, ${publicId}, ${accountId}, NULL, 'hidden', ${JSON.stringify(detail)}, 0
        WHERE ${and(notExists(existingSubmission), notExists(duplicate), notExists(exhaustedQuota))}`),
      this.db.insert(submissions)
        .select(sql`SELECT NULL, ${accountId}, ${clientId}, ${submittedAt}, 'pending_review', ${runs.sequence}, NULL, ${requestFingerprint}, NULL
        FROM ${runs} WHERE ${and(eq(runs.publicId, publicId), notExists(existingSubmission))}`),
      this.db
        .select({
          status: submissions.status,
          requestFingerprint: submissions.requestFingerprint,
          detail: runs.detail,
          publicId: runs.publicId,
          visibility: runs.visibility,
          publishedAt: runs.publishedAt,
        })
        .from(submissions)
        .leftJoin(runs, eq(runs.sequence, submissions.runSequence))
        .where(and(eq(submissions.accountId, accountId), eq(submissions.clientRunId, clientId))),
      duplicate,
    ]);
    const stored = result[0];

    if (!stored) {
      if (duplicates.length > 0) {
        throw new BenchmarkRequestError('duplicate_run');
      }

      if (quota[0]) {
        const retryAfter = Math.max(
          1,
          Math.ceil((Date.parse(quota[0].submittedAt) + SUBMISSION_QUOTA_WINDOW_MS - now) / 1000),
        );
        throw new BenchmarkRequestError('rate_limited', retryAfter);
      }

      throw new Error('Submission is missing after its transaction.');
    }

    if (stored.status === 'deleted') {
      throw new BenchmarkRequestError('publication_deleted');
    }

    if (stored.detail === null) {
      throw new Error('Submission run is missing.');
    }

    const existing = publicRunDetailSchema.parse(JSON.parse(stored.detail));
    const existingId = existing.public_run_id;
    const existingData = submissionDataSchema.strip().parse(existing);

    if (
      stored.requestFingerprint !== requestFingerprint ||
      JSON.stringify(existingData) !== JSON.stringify(normalized)
    ) {
      throw new BenchmarkRequestError('idempotency_conflict');
    }

    if (
      stored.publicId !== existingId ||
      (stored.status === 'published'
        ? stored.visibility !== 'published' || stored.publishedAt === null
        : stored.visibility !== 'hidden')
    ) {
      throw new Error('Submission publication state is inconsistent.');
    }

    if (stored.status === 'published') {
      return {
        client_run_id: clientId,
        publication_status: 'published',
        public_run_id: existingId,
        url: existing.url,
      };
    }

    if (stored.status === 'rejected') {
      return {
        client_run_id: clientId,
        publication_status: 'rejected',
        public_run_id: null,
        url: null,
        status_reason: 'rejected',
      };
    }

    return {
      client_run_id: clientId,
      publication_status: stored.status,
      public_run_id: null,
      url: null,
    };
  }
}
