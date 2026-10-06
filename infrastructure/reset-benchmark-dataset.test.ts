import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { publicRunDetailSchema } from '@timmy/contracts';

import {
  parseResetDatasetCounts,
  resetBenchmarkDatasetPlan,
  resetDatasetCountsQuery,
} from './reset-benchmark-dataset.ts';

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('./migrations/', import.meta.url);

  // Repository-owned migration directory, never a supplied filesystem path.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const files = readdirSync(directory)
    .filter(file => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    // Only the repository-owned migration directory is read.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    db.exec(readFileSync(new URL(file, directory), 'utf8'));
  }

  db.exec(`
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO d1_migrations VALUES (1, 'existing-migration');
    INSERT INTO accounts VALUES ('owner-private'), ('other-private');
    INSERT INTO account_identities VALUES ('https://clerk.example.test', 'private-subject', 'owner-private');
    INSERT INTO benchmark_runs (sequence, public_id, contributor_key, published_at, visibility, detail)
      VALUES (900, 'br_old', 'other-private', '2026-10-01T00:00:00Z', 'published', '{"public_run_id":"br_old"}');
    INSERT INTO benchmark_submissions (sequence, account_id, client_run_id, submitted_at, status, run_sequence)
      VALUES (800, 'other-private', 'old-client', '2026-10-01T00:00:00Z', 'published', 900);
    INSERT INTO benchmark_measurement_archive VALUES ('old-archive', '{}');
  `);

  return db;
}

function counts(db: DatabaseSync): ReturnType<typeof parseResetDatasetCounts> {
  return parseResetDatasetCounts(
    JSON.stringify([{ success: true, results: db.prepare(resetDatasetCountsQuery()).all() }]),
  );
}

await test('clears all three benchmark tables and reseeds valid telemetry while preserving schema, identities and counters', () => {
  const db = fixture();

  try {
    const schema = db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name').all();
    const accounts = db.prepare('SELECT * FROM accounts ORDER BY id').all();
    const identities = db.prepare('SELECT * FROM account_identities').all();
    const migrations = db.prepare('SELECT * FROM d1_migrations').all();
    const before = counts(db);
    assert.equal(before.runs, 1);
    assert.equal(before.submissions, 1);
    assert.equal(before.archive, 1);
    const plan = resetBenchmarkDatasetPlan();

    // D1's remote file import supplies the transaction; SQLite exercises the same
    // generated statements in one transaction without touching a real database.
    db.exec('BEGIN');
    db.exec(plan.sql);
    db.exec('COMMIT');
    const after = counts(db);
    assert.equal(plan.demoRunCount, 397);
    assert.equal(after.runs, 397);
    assert.equal(after.synthetic_runs, 397);
    assert.equal(after.submissions, 0);
    assert.equal(after.archive, 0);
    assert.ok(after.revision > before.revision);
    assert.deepEqual(db.prepare('SELECT * FROM accounts ORDER BY id').all(), accounts);
    assert.deepEqual(db.prepare('SELECT * FROM account_identities').all(), identities);
    assert.deepEqual(db.prepare('SELECT * FROM d1_migrations').all(), migrations);
    assert.deepEqual(
      db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name').all(),
      schema,
    );
    assert.equal(
      db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'benchmark_submissions'").get()?.seq,
      800,
    );

    for (const row of db.prepare('SELECT sequence, detail FROM benchmark_runs').all()) {
      assert.ok(Number(row.sequence) > 900);
      const detail = publicRunDetailSchema.parse(JSON.parse(String(row.detail)));
      assert.equal(detail.is_synthetic, true);
      assert.equal(detail.resource_telemetry.schema_version, 1);
    }
  } finally {
    db.close();
  }
});

await test('a seed failure in the import transaction restores old data and revision', () => {
  const db = fixture();

  try {
    const before = counts(db);
    const runs = db.prepare('SELECT * FROM benchmark_runs').all();
    const submissions = db.prepare('SELECT * FROM benchmark_submissions').all();
    const archive = db.prepare('SELECT * FROM benchmark_measurement_archive').all();
    db.exec('BEGIN');
    assert.throws(() =>
      db.exec(resetBenchmarkDatasetPlan().sql + '\nINSERT INTO missing_table VALUES (1);'),
    );
    db.exec('ROLLBACK');
    assert.deepEqual(counts(db), before);
    assert.deepEqual(db.prepare('SELECT * FROM benchmark_runs').all(), runs);
    assert.deepEqual(db.prepare('SELECT * FROM benchmark_submissions').all(), submissions);
    assert.deepEqual(db.prepare('SELECT * FROM benchmark_measurement_archive').all(), archive);
  } finally {
    db.close();
  }
});

await test('CLI check requires a manual master run, reviewed audit and target-specific confirmation without accessing D1', () => {
  const environment = {
    ...process.env,
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/master',
    RESET_ENVIRONMENT: 'staging',
    RESET_AUDIT_REVIEWED: 'true',
    RESET_CONFIRMATION: 'RESET staging',
  };

  for (const override of [
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_REF: 'refs/heads/feat/resource-telemetry' },
    { RESET_ENVIRONMENT: 'local' },
    { RESET_AUDIT_REVIEWED: 'false' },
    { RESET_CONFIRMATION: 'RESET production' },
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'infrastructure/reset-benchmark-dataset.ts', '--check'],
      { encoding: 'utf8', env: { ...environment, ...override } },
    );
    assert.equal(result.status, 1);
  }

  for (const target of ['staging', 'production']) {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'infrastructure/reset-benchmark-dataset.ts', '--check'],
      {
        encoding: 'utf8',
        env: { ...environment, RESET_ENVIRONMENT: target, RESET_CONFIRMATION: `RESET ${target}` },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no database operation performed/);
  }
});

await test('counts reject failed or malformed output and private extra fields', () => {
  const row = {
    submissions: 0,
    runs: 397,
    synthetic_runs: 397,
    archive: 0,
    accounts: 2,
    identities: 1,
    revision: 5,
  };
  assert.deepEqual(
    parseResetDatasetCounts(JSON.stringify([{ success: true, results: [row] }])),
    row,
  );

  for (const output of [
    'native failure with private values',
    JSON.stringify([{ success: false, results: [row] }]),
    JSON.stringify([{ success: true, results: [] }]),
    JSON.stringify([{ success: true, results: [{ ...row, account_id: 'private' }] }]),
    JSON.stringify([{ success: true, results: [{ ...row, revision: null }] }]),
  ]) {
    assert.throws(() => parseResetDatasetCounts(output));
  }
});

await test('reset workflow stays manual, environment-protected and serialized with deploy, without deploying or migrating', () => {
  // Fixed repository-owned workflow path.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const workflow = readFileSync(
    new URL('../.github/workflows/reset-benchmark-dataset.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:|db:migrate|deploy:|wrangler deploy/);
  assert.match(workflow, /environment: \$\{\{ inputs.environment \}\}/);
  assert.match(workflow, /group: academy-\$\{\{ inputs.environment \}\}-database/);
  assert.match(workflow, /node infrastructure\/production-approval.ts/);
  assert.match(workflow, /needs: check/);
  const resetStep = workflow.slice(workflow.indexOf('name: Verify approval, reset'));
  assert.match(resetStep, /GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.deepEqual(
    [...workflow.matchAll(/secrets\.([A-Z_]+)/g)]
      .map(match => match[1]!)
      .sort((left, right) => left.localeCompare(right)),
    ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  );
});
