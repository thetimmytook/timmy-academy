import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';

import { demoSeedStatements } from '../apps/api/src/benchmark/demo-seed.ts';
import {
  accountIdentities,
  accounts,
  measurementArchive,
  runs,
  state,
  submissions,
} from '../apps/api/src/db/schema.ts';

import { checkDatabaseTarget } from './database-config.ts';
import { checkProductionApproval } from './production-approval.ts';
import { runWrangler } from './run-wrangler.ts';

const dialect = new SQLiteSyncDialect();
const integer = z.number().int().nonnegative();
const countsSchema = z.strictObject({
  submissions: integer,
  runs: integer,
  synthetic_runs: integer,
  archive: integer,
  accounts: integer,
  identities: integer,
  revision: integer,
});
type Counts = z.infer<typeof countsSchema>;
type Environment = 'staging' | 'production';

export function requireResetIntent(): Environment {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REF !== 'refs/heads/master'
  ) {
    throw new Error('Remote reset requires a manual GitHub Actions run from master.');
  }

  const environment = process.env.RESET_ENVIRONMENT;

  if (
    (environment !== 'staging' && environment !== 'production') ||
    process.env.RESET_AUDIT_REVIEWED !== 'true' ||
    process.env.RESET_CONFIRMATION !== `RESET ${environment}`
  ) {
    throw new Error(
      'Review the audit and explicitly confirm RESET followed by the selected target.',
    );
  }

  return environment;
}

export function resetBenchmarkDatasetPlan(): { sql: string; demoRunCount: number } {
  const seed = demoSeedStatements();

  // Delete referencing submissions first. Keep accounts, identities, migration
  // history, revision state and AUTOINCREMENT counters; existing triggers still run.
  const reset = [
    sql`DELETE FROM ${submissions}`,
    sql`DELETE FROM ${runs}`,
    sql`DELETE FROM ${measurementArchive}`,
  ].map(query => dialect.sqlToQuery(query).sql + ';');

  // One remote --file import contains the reset and the complete fresh demo seed.
  // Do not split this into independently applied destructive and seed commands.
  return { sql: [...reset, ...seed].join('\n'), demoRunCount: seed.length };
}

export function resetDatasetCountsQuery(): string {
  return dialect.sqlToQuery(sql`SELECT
    (SELECT count(*) FROM ${submissions}) AS submissions,
    (SELECT count(*) FROM ${runs}) AS runs,
    (SELECT count(*) FROM ${runs} WHERE ${runs.isSynthetic} = 1) AS synthetic_runs,
    (SELECT count(*) FROM ${measurementArchive}) AS archive,
    (SELECT count(*) FROM ${accounts}) AS accounts,
    (SELECT count(*) FROM ${accountIdentities}) AS identities,
    (SELECT ${state.revision} FROM ${state} WHERE ${state.id} = 1) AS revision`).sql;
}

export function parseResetDatasetCounts(output: string): Counts {
  const envelope = z
    .array(z.object({ success: z.literal(true), results: z.array(countsSchema).length(1) }))
    .length(1)
    .parse(JSON.parse(output));

  return envelope[0]!.results[0]!;
}

function readCounts(environment: Environment): Counts {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'BENCHMARK_DB',
      '--config',
      'infrastructure/wrangler.jsonc',
      '--env',
      environment,
      '--remote',
      '--command',
      resetDatasetCountsQuery(),
      '--json',
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 60000,
      env: { ...process.env, CI: 'true' },
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error('Dataset counts could not be established.');
  }

  // Never log raw query output, private payloads or native errors.
  return parseResetDatasetCounts(result.stdout);
}

function report(message: string): void {
  process.stdout.write(message + '\n');
  const summary = process.env.GITHUB_STEP_SUMMARY;

  if (summary) {
    // GitHub supplies this runner-owned summary path.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    appendFileSync(summary, message + '\n');
  }
}

async function main(): Promise<void> {
  if (process.argv.length > 3 || (process.argv[2] !== undefined && process.argv[2] !== '--check')) {
    throw new Error('Only optional --check is supported.');
  }

  const environment = requireResetIntent();
  checkDatabaseTarget(environment);

  if (process.argv[2] === '--check') {
    console.log(`Manual ${environment} reset request confirmed; no database operation performed.`);

    return;
  }

  const plan = resetBenchmarkDatasetPlan();
  mkdirSync('infrastructure/.wrangler', { recursive: true });
  const file = 'infrastructure/.wrangler/reset-benchmark-dataset.sql';
  writeFileSync(file, plan.sql);
  const before = readCounts(environment);
  report(`## Benchmark dataset reset — ${environment}\n\nBefore: ${JSON.stringify(before)}\n`);

  if (environment === 'production') {
    // Recheck current protection and actual approval immediately before mutation.
    await checkProductionApproval();
  }

  runWrangler([
    'd1',
    'execute',
    'BENCHMARK_DB',
    '--config',
    'infrastructure/wrangler.jsonc',
    '--env',
    environment,
    '--remote',
    '--file',
    file,
    '--yes',
  ]);

  const after = readCounts(environment);
  report(`After: ${JSON.stringify(after)}\n`);

  if (
    after.submissions !== 0 ||
    after.archive !== 0 ||
    after.runs !== plan.demoRunCount ||
    after.synthetic_runs !== plan.demoRunCount ||
    after.accounts !== before.accounts ||
    after.identities !== before.identities ||
    after.revision < before.revision
  ) {
    throw new Error('Post-reset counts do not match the expected fresh demo dataset.');
  }

  report(
    `Verified ${plan.demoRunCount} synthetic runs, empty submissions/archive and preserved account counts.`,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error(
      'Reset did not complete or could not be verified. Review this run before retrying; raw query errors were withheld.',
    );
    process.exitCode = 1;
  }
}
