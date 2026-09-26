import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import type { ArchivedMeasurement } from '../benchmark/archived-measurement';
import type { HasGenerated } from 'drizzle-orm';
import type {
  SQLiteIntegerBuilderInitial,
  SQLiteTextBuilderInitial,
} from 'drizzle-orm/sqlite-core';

type GeneratedText = HasGenerated<
  SQLiteTextBuilderInitial<string, [string, ...string[]], number | undefined>,
  { type: 'always' }
>;
type GeneratedInteger = HasGenerated<SQLiteIntegerBuilderInitial<string>, { type: 'always' }>;

// Provider identities are private and never appear in benchmark public projections.
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
});
export const accountIdentities = sqliteTable(
  'account_identities',
  {
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
  },
  table => [
    primaryKey({ columns: [table.issuer, table.subject] }),
    index('identities_account').on(table.accountId),
  ],
);

// JSON contains only the accepted public document; private ownership stays separate.
// Generated columns keep indexed predicates inseparable from that document.
const jsonText = (name: string, path: string): GeneratedText =>
  text(name).generatedAlwaysAs(sql.raw(`json_extract(detail, '${path}')`));
const jsonInt = (name: string, path: string): GeneratedInteger =>
  integer(name).generatedAlwaysAs(sql.raw(`json_extract(detail, '${path}')`));
export const runs = sqliteTable(
  'benchmark_runs',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    publicId: text('public_id').notNull().unique(),
    contributor: text('contributor_key').notNull(),
    publishedAt: text('published_at'),
    visibility: text('visibility', { enum: ['published', 'hidden', 'deleted'] })
      .notNull()
      .default('published'),
    detail: text('detail').notNull(),
    isSynthetic: integer('is_synthetic', { mode: 'boolean' }).notNull().default(false),
    cpu: jsonText('cpu', '$.hardware.cpu.id'),
    gpu: jsonText('gpu', '$.hardware.gpu.id'),
    ram: jsonInt('ram_gb', '$.hardware.ram_gb'),
    map: jsonText('map', '$.conditions.map.id'),
    execution: jsonText('execution', '$.conditions.execution'),
    width: jsonInt('game_width', '$.conditions.game_resolution.width'),
    height: jsonInt('game_height', '$.conditions.game_resolution.height'),
    version: jsonText('game_version', '$.conditions.game_version'),
    day: jsonText('captured_day', '$.captured_day'),
  },
  table => [
    check(
      'valid_detail',
      sql`json_valid(${table.detail}) AND json_extract(${table.detail}, '$.public_run_id') = ${table.publicId}`,
    ),
    check(
      'published_timestamp',
      sql`${table.visibility} <> 'published' OR ${table.publishedAt} IS NOT NULL`,
    ),
    check('valid_visibility', sql`${table.visibility} IN ('published', 'hidden', 'deleted')`),
    index('runs_order').on(table.visibility, table.day, table.publishedAt, table.publicId),
    index('runs_hardware_cohort').on(
      table.visibility,
      table.cpu,
      table.gpu,
      table.ram,
      table.map,
      table.execution,
      table.width,
      table.height,
      table.version,
    ),
    index('runs_gpu').on(table.visibility, table.gpu, table.ram),
    index('runs_map').on(table.visibility, table.map),
    index('runs_resolution_version').on(table.visibility, table.width, table.height, table.version),
  ],
);

// Private submission metadata is never part of the anonymous benchmark projection.
export const submissions = sqliteTable(
  'benchmark_submissions',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    clientRunId: text('client_run_id').notNull(),
    submittedAt: text('submitted_at').notNull(),
    status: text('status', { enum: ['pending_review', 'published', 'rejected', 'deleted'] })
      .notNull()
      .default('pending_review'),
    runSequence: integer('run_sequence').references(() => runs.sequence),
    statusReason: text('status_reason'),
    requestFingerprint: text('request_fingerprint'),
    deletedPublicId: text('deleted_public_id'),
  },
  table => [
    uniqueIndex('submissions_account_client').on(table.accountId, table.clientRunId),
    uniqueIndex('submissions_deleted_public_id').on(table.deletedPublicId),
    uniqueIndex('submissions_run').on(table.runSequence),
    index('submissions_owner_order').on(table.accountId, table.submittedAt, table.sequence),
    index('submissions_owner_status_order').on(
      table.accountId,
      table.status,
      table.submittedAt,
      table.sequence,
    ),
    check(
      'submission_status',
      sql`${table.status} IN ('pending_review', 'published', 'rejected', 'deleted')`,
    ),
    check(
      'submission_run_link',
      sql`(${table.status} = 'deleted' AND ${table.runSequence} IS NULL) OR (${table.status} <> 'deleted' AND ${table.runSequence} IS NOT NULL)`,
    ),
    check(
      'submission_reason',
      sql`(${table.status} = 'rejected' AND ${table.statusReason} IS NOT NULL AND length(trim(${table.statusReason})) > 0) OR (${table.status} <> 'rejected' AND ${table.statusReason} IS NULL)`,
    ),
  ],
);

export const state = sqliteTable('benchmark_state', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
});

// Closed analysis archive. No dates, source IDs, ownership links or archive-to-submission mapping.
export const measurementArchive = sqliteTable(
  'benchmark_measurement_archive',
  {
    id: text('id').primaryKey().notNull(),
    detail: text('detail', { mode: 'json' }).$type<ArchivedMeasurement>().notNull(),
  },
  table => [check('valid_archived_measurement', sql`json_valid(${table.detail})`)],
);
