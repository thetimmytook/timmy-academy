import { and, eq, exists, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { runs, submissions } from '../db/schema';

import { BenchmarkRequestError } from './repository';

import type { D1Database } from '@cloudflare/workers-types';

// Private moderation operation; never an owner action.
export class D1SubmissionRejection {
  private readonly db;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async reject(submissionId: number): Promise<{ status: 'rejected' } | undefined> {
    const hiddenRun = this.db
      .select({ sequence: runs.sequence })
      .from(runs)
      .where(
        and(
          eq(runs.sequence, submissions.runSequence),
          eq(runs.visibility, 'hidden'),
          isNull(runs.publishedAt),
        ),
      );
    const [, rows] = await this.db.batch([
      this.db
        .update(submissions)
        .set({ status: 'rejected', statusReason: 'rejected' })
        .where(
          and(
            eq(submissions.sequence, submissionId),
            eq(submissions.status, 'pending_review'),
            exists(hiddenRun),
          ),
        ),
      this.db
        .select({
          status: submissions.status,
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

    if (row.status !== 'rejected') {
      throw new BenchmarkRequestError('moderation_conflict');
    }

    if (row.visibility !== 'hidden' || row.publishedAt !== null) {
      throw new Error('Submission cannot be rejected in its current state.');
    }

    return { status: 'rejected' };
  }
}
