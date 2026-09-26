import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { runs, submissions } from '../db/schema';

import type { D1Database } from '@cloudflare/workers-types';

export interface ApprovedSubmission {
  publicRunId: string;
  publishedAt: string;
}

// Private moderation operation. User-facing routes must never call this as an owner action.
export class D1SubmissionApproval {
  private readonly db;
  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async approve(submissionId: number): Promise<ApprovedSubmission | undefined> {
    const pendingRun = this.db
      .select({ sequence: submissions.runSequence })
      .from(submissions)
      .where(and(eq(submissions.sequence, submissionId), eq(submissions.status, 'pending_review')));
    const [, , rows] = await this.db.batch([
      this.db
        .update(runs)
        .set({ visibility: 'published', publishedAt: new Date().toISOString() })
        .where(
          and(
            inArray(runs.sequence, pendingRun),
            eq(runs.visibility, 'hidden'),
            isNull(runs.publishedAt),
          ),
        ),
      this.db
        .update(submissions)
        .set({ status: 'published' })

        // Only change the submission when the preceding UPDATE published its run.
        // SQLite changes() excludes trigger writes, including revision increments.
        .where(
          and(
            eq(submissions.sequence, submissionId),
            eq(submissions.status, 'pending_review'),
            sql`changes() = 1`,
          ),
        ),
      this.db
        .select({
          status: submissions.status,
          publicRunId: runs.publicId,
          visibility: runs.visibility,
          publishedAt: runs.publishedAt,
        })
        .from(submissions)
        .leftJoin(runs, eq(runs.sequence, submissions.runSequence))
        .where(eq(submissions.sequence, submissionId)),
    ]);
    const row = rows[0];

    if (!row) {
      return undefined;
    }

    if (
      row.status !== 'published' ||
      row.visibility !== 'published' ||
      row.publicRunId === null ||
      row.publishedAt === null
    ) {
      throw new Error('Submission cannot be approved in its current state.');
    }

    return { publicRunId: row.publicRunId, publishedAt: row.publishedAt };
  }
}
