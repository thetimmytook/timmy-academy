import { moderationRunSchema } from '@timmy/contracts';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { runs, submissions } from '../db/schema';

import type { D1Database } from '@cloudflare/workers-types';
import type { ModerationQuery, ModerationQueue } from '@timmy/contracts';

export class D1ModerationRepository {
  private readonly db;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async pending(query: ModerationQuery): Promise<ModerationQueue> {
    const rows = await this.db
      .select({
        submission_id: submissions.sequence,
        submitted_at: submissions.submittedAt,
        detail: runs.detail,
      })
      .from(submissions)
      .innerJoin(runs, eq(runs.sequence, submissions.runSequence))
      .where(
        and(
          eq(submissions.status, 'pending_review'),
          eq(runs.visibility, 'hidden'),
          isNull(runs.publishedAt),
          query.after === undefined ? undefined : gt(submissions.sequence, query.after),
        ),
      )
      .orderBy(asc(submissions.sequence))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);

    return {
      items: page.map(({ detail, ...item }) => ({
        ...item,
        run: moderationRunSchema.strip().parse(JSON.parse(detail)),
      })),
      next_after: rows.length > query.limit ? page.at(-1)!.submission_id : null,
    };
  }
}
