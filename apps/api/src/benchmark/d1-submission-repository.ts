import { publicRunDetailSchema } from '@timmy/contracts';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { runs, submissions } from '../db/schema';

import type { D1Database } from '@cloudflare/workers-types';
import type { PublicRunDetail } from '@timmy/contracts';

export type SubmissionStatus = 'published' | 'pending_review' | 'rejected';
export interface OwnerSubmission {
  client_run_id: string;
  publication_status: SubmissionStatus;
  public_run_id: string | null;
  url: string | null;
  submitted_at: string;
  captured_day: string;
  hardware: { cpu: string; gpu: string; ram_gb: number };
  map: PublicRunDetail['conditions']['map'];
  execution: PublicRunDetail['conditions']['execution'];
  game_resolution: PublicRunDetail['conditions']['game_resolution'];
  metrics: { average_fps: number; one_percent_low_fps: number };
  status_reason: string | null;
}
export interface DeletedSubmission {
  client_run_id: string;
  publication_status: 'deleted';
  public_run_id: null;
  url: null;
}

// Internal keyset position, not an HTTP cursor. The API must authenticate and bind its cursor.
export interface SubmissionPosition {
  submittedAt: string;
  sequence: number;
}
export interface SubmissionPageQuery {
  status?: SubmissionStatus | 'all';
  limit?: number;
  after?: SubmissionPosition;
}
export interface SubmissionPage {
  items: OwnerSubmission[];
  next: SubmissionPosition | null;
}

const columns = {
  sequence: submissions.sequence,
  clientRunId: submissions.clientRunId,
  submittedAt: submissions.submittedAt,
  status: submissions.status,
  reason: submissions.statusReason,
  detail: runs.detail,
  publicId: runs.publicId,
  visibility: runs.visibility,
};
interface SubmissionRow {
  sequence: number;
  clientRunId: string;
  submittedAt: string;
  status: SubmissionStatus | 'deleted';
  reason: string | null;
  detail: string | null;
  publicId: string | null;
  visibility: string | null;
}

function project(row: SubmissionRow): OwnerSubmission | DeletedSubmission {
  if (row.status === 'deleted') {
    return {
      client_run_id: row.clientRunId,
      publication_status: 'deleted',
      public_run_id: null,
      url: null,
    };
  }

  if (row.detail === null) {
    throw new Error('Submission is missing its run data.');
  }

  const detail = publicRunDetailSchema.parse(JSON.parse(row.detail));
  const published = row.status === 'published';

  if (published && (row.visibility !== 'published' || row.publicId !== detail.public_run_id)) {
    throw new Error('Submission publication state is inconsistent.');
  }

  return {
    client_run_id: row.clientRunId,
    publication_status: row.status,
    public_run_id: published ? detail.public_run_id : null,
    url: published ? `/bench/runs/${detail.public_run_id}` : null,
    submitted_at: row.submittedAt,
    captured_day: detail.captured_day,
    hardware: {
      cpu: detail.hardware.cpu.name,
      gpu: detail.hardware.gpu.name,
      ram_gb: detail.hardware.ram_gb,
    },
    map: { id: detail.conditions.map.id, name: detail.conditions.map.name },
    execution: detail.conditions.execution,
    game_resolution: detail.conditions.game_resolution,
    metrics: {
      average_fps: detail.metrics.average_fps,
      one_percent_low_fps: detail.metrics.one_percent_low_fps,
    },
    status_reason: row.reason,
  };
}

export class D1SubmissionRepository {
  private readonly db;
  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async findByClientId(
    accountId: string,
    clientRunId: string,
  ): Promise<OwnerSubmission | DeletedSubmission | undefined> {
    const row = await this.db
      .select(columns)
      .from(submissions)
      .leftJoin(runs, eq(submissions.runSequence, runs.sequence))
      .where(and(eq(submissions.accountId, accountId), eq(submissions.clientRunId, clientRunId)))
      .get();

    return row ? project(row) : undefined;
  }

  async list(accountId: string, query: SubmissionPageQuery = {}): Promise<SubmissionPage> {
    const limit = query.limit ?? 20;

    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('Invalid submission page size.');
    }

    const rows = await this.db
      .select(columns)
      .from(submissions)
      .leftJoin(runs, eq(submissions.runSequence, runs.sequence))
      .where(
        and(
          eq(submissions.accountId, accountId),
          ne(submissions.status, 'deleted'),
          query.status && query.status !== 'all' ? eq(submissions.status, query.status) : undefined,
          query.after
            ? sql`(${submissions.submittedAt}, ${submissions.sequence}) < (${query.after.submittedAt}, ${query.after.sequence})`
            : undefined,
        ),
      )
      .orderBy(desc(submissions.submittedAt), desc(submissions.sequence))
      .limit(limit + 1)
      .all();
    const selected = rows.slice(0, limit);
    const items = selected.map(row => {
      const item = project(row);

      if (item.publication_status === 'deleted') {
        throw new Error('Deleted submission in owner list.');
      }

      return item;
    });
    const last = selected.at(-1);

    return {
      items,
      next:
        rows.length > limit && last
          ? { submittedAt: last.submittedAt, sequence: last.sequence }
          : null,
    };
  }
}
