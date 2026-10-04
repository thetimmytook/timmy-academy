import { and, count, countDistinct, eq, exists, isNull, max, min, ne, or, sql } from 'drizzle-orm';
import { QueryBuilder, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';

import { accountIdentities, runs, submissions } from '../apps/api/src/db/schema.ts';

const publicId = z.string().regex(/^br_[A-Za-z0-9_-]{1,100}$/);
const integer = z.number().int().nonnegative();
const rowSchema = z.strictObject({
  kind: z.enum(['mapping', 'total', 'status']),
  scope: z.number().int().min(-1).max(1),
  status: z.enum(['pending_review', 'published', 'rejected', 'deleted']).nullable(),
  submission_count: integer,
  sender_count: integer,
  first_submitted_at: z.iso.datetime().nullable(),
  last_submitted_at: z.iso.datetime().nullable(),
  owner_count: integer,
});

// A single SELECT sees one consistent dataset. No identity or payload is selected
// into the report; account IDs remain inside CTEs for ownership and distinct counts.
export function submissionAuditQuery(ownerRunId: string, issuer: string): string {
  const ownerId = publicId.parse(ownerRunId);

  if (!issuer) {
    throw new Error('The target Clerk issuer is required.');
  }

  const db = new QueryBuilder();
  const authenticated = exists(
    db
      .select({ account: accountIdentities.accountId })
      .from(accountIdentities)
      .where(
        and(
          eq(accountIdentities.accountId, submissions.accountId),
          eq(accountIdentities.issuer, issuer),
        ),
      ),
  );
  const owner = db.$with('audit_owner').as(
    db
      .select({ account: submissions.accountId })
      .from(submissions)
      .innerJoin(runs, eq(runs.sequence, submissions.runSequence))
      .where(
        and(
          eq(runs.publicId, ownerId),
          eq(runs.isSynthetic, false),
          eq(runs.visibility, 'published'),
          eq(submissions.status, 'published'),
          authenticated,
        ),
      ),
  );
  const real = db.$with('audit_real').as(
    db
      .select({
        account: submissions.accountId,
        status: submissions.status,
        submitted: submissions.submittedAt,
      })
      .from(submissions)
      .leftJoin(runs, eq(runs.sequence, submissions.runSequence))
      .where(
        and(
          authenticated,
          or(
            and(eq(submissions.status, 'deleted'), isNull(submissions.runSequence)),
            and(ne(submissions.status, 'deleted'), eq(runs.isSynthetic, false)),
          ),
        ),
      ),
  );
  const scope = sql<number>`CASE WHEN ${real.account} = (SELECT ${owner.account} FROM ${owner}) THEN 1 ELSE 0 END`;
  const fields = {
    submission_count: count(),
    sender_count: countDistinct(real.account),
    first_submitted_at: min(real.submitted),
    last_submitted_at: max(real.submitted),
    owner_count: sql<number>`(SELECT count(*) FROM ${owner})`,
  };
  const totals = db
    .select({ kind: sql<string>`'total'`, scope, status: sql<string | null>`NULL`, ...fields })
    .from(real)
    .groupBy(scope);
  const statuses = db
    .select({ kind: sql<string>`'status'`, scope, status: real.status, ...fields })
    .from(real)
    .groupBy(scope, real.status);
  const query = db
    .with(owner, real)
    .select({
      kind: sql<string>`'mapping'`.as('kind'),
      scope: sql<number>`-1`.as('scope'),
      status: sql<string | null>`NULL`.as('status'),
      submission_count: sql<number>`0`.as('submission_count'),
      sender_count: sql<number>`0`.as('sender_count'),
      first_submitted_at: sql<string | null>`NULL`.as('first_submitted_at'),
      last_submitted_at: sql<string | null>`NULL`.as('last_submitted_at'),
      owner_count: countDistinct(owner.account).as('owner_count'),
    })
    .from(owner)
    .unionAll(totals)
    .unionAll(statuses);

  // Wrangler accepts SQL text, not bound parameters. Drizzle escapes the inline
  // values; neither workflow inputs nor private account IDs become raw SQL.
  return new SQLiteSyncDialect().sqlToQuery(query.getSQL().inlineParams()).sql;
}

export function submissionAuditReport(rows: unknown): string {
  const parsed = z.array(rowSchema).parse(rows);
  const mappings = parsed.filter(row => row.kind === 'mapping');

  if (mappings.length !== 1 || mappings[0]!.owner_count !== 1) {
    throw new Error('The supplied published run has no verified, unique account mapping.');
  }

  const lines = [
    '## Authenticated benchmark submissions',
    '',
    'Owner mapping: verified from the supplied published run.',
    '',
    'Synthetic runs and fixture contributors are excluded. Dates are submission dates in UTC.',
    '',
    '| Scope | Status | Submissions | Distinct senders | First submitted | Last submitted |',
    '| --- | --- | ---: | ---: | --- | --- |',
  ];

  for (const scope of [1, 0]) {
    for (const status of [null, 'pending_review', 'published', 'rejected', 'deleted']) {
      const row = parsed.find(
        value =>
          value.scope === scope &&
          value.status === status &&
          value.kind === (status === null ? 'total' : 'status'),
      );
      lines.push(
        `| ${scope === 1 ? 'Owner' : 'Other users'} | ${status ?? 'All statuses'} | ${row?.submission_count ?? 0} | ${row?.sender_count ?? 0} | ${row?.first_submitted_at ?? '—'} | ${row?.last_submitted_at ?? '—'} |`,
      );
    }
  }

  lines.push(
    '',
    'Distinct sender totals are counted across all statuses, rather than added from the status rows.',
    'Deleted submissions use authenticated deletion markers; deleted measurements and their payloads are not read.',
  );

  return lines.join('\n') + '\n';
}

export function parseAuditOutput(output: string): string {
  const envelope = z
    .array(z.object({ success: z.literal(true), results: z.unknown() }))
    .length(1)
    .parse(JSON.parse(output));

  return submissionAuditReport(envelope[0]!.results);
}
