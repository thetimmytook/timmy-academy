import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
    publishedAt: text('published_at').notNull(),
    visibility: text('visibility', { enum: ['published', 'hidden', 'deleted'] })
      .notNull()
      .default('published'),
    detail: text('detail').notNull(),
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
export const state = sqliteTable('benchmark_state', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
});
export const tokens = sqliteTable(
  'benchmark_tokens',
  {
    token: text('token').primaryKey(),
    expiresAt: integer('expires_at').notNull(),
    payload: text('payload').notNull(),
  },
  table => [index('tokens_expiry').on(table.expiresAt)],
);
