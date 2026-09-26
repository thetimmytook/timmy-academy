import { publicRunDetailSchema } from '@timmy/contracts';
import { and, eq, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { measurementArchive, runs, submissions } from '../db/schema';

import { projectArchivedMeasurement } from './archived-measurement';
import { BenchmarkRequestError } from './repository';

import type { ArchivedMeasurement } from './archived-measurement';
import type { D1Database } from '@cloudflare/workers-types';

export interface DeletionReceipt {
  publication_status: 'deleted';
  public_run_id: string;
}

export class D1SubmissionDeletion {
  private readonly db;
  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async delete(accountId: string, publicRunId: string): Promise<DeletionReceipt> {
    const stored = await this.db
      .select({
        sequence: submissions.sequence,
        accountId: submissions.accountId,
        status: submissions.status,
        detail: runs.detail,
      })
      .from(submissions)
      .leftJoin(runs, eq(runs.sequence, submissions.runSequence))
      .where(
        or(
          and(
            eq(runs.publicId, publicRunId),
            eq(runs.visibility, 'published'),
            eq(submissions.status, 'published'),
          ),
          and(eq(submissions.deletedPublicId, publicRunId), eq(submissions.status, 'deleted')),
        ),
      )
      .get();

    if (!stored) {
      throw new BenchmarkRequestError('not_found');
    }

    if (stored.accountId !== accountId) {
      throw new BenchmarkRequestError('not_owner');
    }

    const receipt: DeletionReceipt = { publication_status: 'deleted', public_run_id: publicRunId };

    if (stored.status === 'deleted') {
      return receipt;
    }

    if (stored.detail === null) {
      throw new Error('Published submission is missing its run.');
    }

    // Published measurements are immutable. Recheck eligibility inside the batch:
    // a concurrent deletion must not create a second archive record.
    const archived = projectArchivedMeasurement(
      publicRunDetailSchema.parse(JSON.parse(stored.detail)),
    );
    const [, , , markers] = await this.db.batch([
      this.db.insert(measurementArchive).select(
        this.db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            detail: sql<ArchivedMeasurement>`${JSON.stringify(archived)}`.as('detail'),
          })
          .from(submissions)
          .innerJoin(runs, eq(runs.sequence, submissions.runSequence))
          .where(
            and(
              eq(submissions.sequence, stored.sequence),
              eq(submissions.accountId, accountId),
              eq(submissions.status, 'published'),
              eq(runs.publicId, publicRunId),
              eq(runs.visibility, 'published'),
            ),
          ),
      ),
      this.db
        .update(submissions)
        .set({
          status: 'deleted',
          runSequence: null,
          requestFingerprint: null,
          deletedPublicId: publicRunId,
        })
        .where(
          and(
            eq(submissions.sequence, stored.sequence),
            eq(submissions.accountId, accountId),
            eq(submissions.status, 'published'),
            sql`changes() = 1`,
          ),
        ),

      // Each mutation is gated by the preceding statement, in the same D1 transaction.
      this.db.delete(runs).where(and(eq(runs.publicId, publicRunId), sql`changes() = 1`)),
      this.db
        .select({ sequence: submissions.sequence })
        .from(submissions)
        .where(
          and(
            eq(submissions.sequence, stored.sequence),
            eq(submissions.accountId, accountId),
            eq(submissions.status, 'deleted'),
            eq(submissions.deletedPublicId, publicRunId),
          ),
        ),
    ]);

    if (!markers[0]) {
      throw new Error('Deletion did not produce its acknowledgement.');
    }

    return receipt;
  }
}
