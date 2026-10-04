import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import {
  parseAuditOutput,
  submissionAuditQuery,
  submissionAuditReport,
} from './audit-submissions-query.ts';

const ownerRun = 'br_d6441fbb-c0af-4db4-9f56-254826da628e';
const issuer = 'https://clerk.example.test';
const ownerAccount = 'owner-private';
const otherAccount = 'other-private';

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE account_identities (issuer TEXT, subject TEXT, account_id TEXT);
    CREATE TABLE benchmark_runs (sequence INTEGER PRIMARY KEY, public_id TEXT,
      contributor_key TEXT, published_at TEXT, visibility TEXT, detail TEXT, is_synthetic INTEGER);
    CREATE TABLE benchmark_submissions (sequence INTEGER PRIMARY KEY, account_id TEXT,
      client_run_id TEXT, submitted_at TEXT, status TEXT, run_sequence INTEGER);
  `);
  const identity = db.prepare('INSERT INTO account_identities VALUES (?, ?, ?)');

  for (const account of [ownerAccount, otherAccount, 'third-private', 'synthetic-private']) {
    identity.run(issuer, 'private-provider-' + account, account);
  }

  identity.run('https://development.example.test', 'private-provider-dev', 'dev-private');
  const run = db.prepare('INSERT INTO benchmark_runs VALUES (?, ?, ?, ?, ?, ?, ?)');
  const submission = db.prepare('INSERT INTO benchmark_submissions VALUES (?, ?, ?, ?, ?, ?)');
  const samples = [
    [ownerAccount, 'published', ownerRun, 0],
    [ownerAccount, 'pending_review', 'br_owner_pending', 0],
    [otherAccount, 'published', 'br_other_public', 0],
    [otherAccount, 'pending_review', 'br_other_pending', 0],
    [otherAccount, 'rejected', 'br_other_rejected', 0],
    ['third-private', 'deleted', null, 0],
    [otherAccount, 'deleted', null, 0],
    ['synthetic-private', 'published', 'br_synthetic', 1],
    ['unverified-private', 'published', 'br_unverified', 0],
    ['dev-private', 'published', 'br_dev', 0],
    [ownerAccount, 'deleted', null, 0],
  ] as const;

  for (const [index, [account, status, publicId, synthetic]] of samples.entries()) {
    const sequence = index + 1;

    if (publicId !== null) {
      run.run(
        sequence,
        publicId,
        account,
        status === 'published' ? '2026-10-04T00:00:00Z' : null,
        status === 'published' ? 'published' : 'hidden',
        '{"private_payload":"not read"}',
        synthetic,
      );
    }

    submission.run(
      sequence,
      account,
      'private-client-' + sequence,
      `2026-10-04T00:${String(sequence).padStart(2, '0')}:00Z`,
      status,
      publicId === null ? null : sequence,
    );
  }

  // A fictional contributor without an authenticated submission is excluded even
  // if an old seed row was not marked synthetic.
  run.run(
    99,
    'br_fictional',
    'fictional-contributor',
    '2026-10-04T00:00:00Z',
    'published',
    '{}',
    0,
  );
  db.exec('PRAGMA query_only = ON');

  return db;
}

await test('one SELECT counts authenticated real submissions, including unlinked deleted markers', () => {
  const db = fixture();

  try {
    const rows = db.prepare(submissionAuditQuery(ownerRun, issuer)).all();
    const others = rows.find(row => row.kind === 'total' && row.scope === 0);
    assert.deepEqual(
      { ...others },
      {
        kind: 'total',
        scope: 0,
        status: null,
        submission_count: 5,
        sender_count: 2,
        first_submitted_at: '2026-10-04T00:03:00Z',
        last_submitted_at: '2026-10-04T00:07:00Z',
        owner_count: 1,
      },
    );
    const mine = rows.find(row => row.kind === 'total' && row.scope === 1);
    assert.equal(mine?.submission_count, 3);
    assert.equal(mine?.sender_count, 1);

    for (const status of ['published', 'pending_review', 'rejected']) {
      assert.equal(
        rows.find(row => row.kind === 'status' && row.scope === 0 && row.status === status)
          ?.submission_count,
        1,
      );
    }

    const deleted = rows.find(
      row => row.kind === 'status' && row.scope === 0 && row.status === 'deleted',
    );
    assert.equal(deleted?.submission_count, 2);
    assert.equal(deleted?.sender_count, 2);
    const report = submissionAuditReport(rows);
    assert.ok(report.includes('| Other users | All statuses | 5 | 2 |'));
    assert.doesNotMatch(
      report,
      /private-|fictional-contributor|br_|client_run_id|account_id|subject/,
    );
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM benchmark_submissions').get()?.count,
      11,
    );
  } finally {
    db.close();
  }
});

await test('missing, hidden, synthetic, unverified and wrong-issuer owner runs fail rather than report zero others', () => {
  const db = fixture();

  try {
    for (const run of [
      'br_missing',
      'br_owner_pending',
      'br_synthetic',
      'br_unverified',
      'br_fictional',
      'br_dev',
    ]) {
      assert.throws(
        () => submissionAuditReport(db.prepare(submissionAuditQuery(run, issuer)).all()),
        /verified, unique account mapping/,
      );
    }
  } finally {
    db.close();
  }
});

await test('zero other users is reported only after a verified owner mapping', () => {
  const db = fixture();

  try {
    db.exec('PRAGMA query_only = OFF');
    db.prepare('DELETE FROM benchmark_submissions WHERE account_id <> ?').run(ownerAccount);
    db.exec('PRAGMA query_only = ON');
    const report = submissionAuditReport(db.prepare(submissionAuditQuery(ownerRun, issuer)).all());
    assert.ok(report.includes('| Other users | All statuses | 0 | 0 |'));
    assert.ok(report.includes('| Owner | All statuses | 3 | 1 |'));
  } finally {
    db.close();
  }
});

await test('rejects input injection, failed query envelopes and additional private output fields', () => {
  assert.throws(() => submissionAuditQuery("br_bad'; DELETE FROM benchmark_runs; --", issuer));
  assert.throws(() => submissionAuditQuery(ownerRun, ''));
  const db = fixture();

  try {
    const rows = db.prepare(submissionAuditQuery(ownerRun, issuer)).all();
    assert.equal(
      parseAuditOutput(
        JSON.stringify([{ success: true, results: rows, meta: { account_id: 'private' } }]),
      ),
      submissionAuditReport(rows),
    );
    assert.throws(() => parseAuditOutput(JSON.stringify([{ success: false, results: rows }])));
    assert.throws(() =>
      parseAuditOutput(
        JSON.stringify([
          { success: true, results: rows.map(row => ({ ...row, email: 'private@example.test' })) },
        ]),
      ),
    );
    assert.throws(() => parseAuditOutput('native error containing private values'));
  } finally {
    db.close();
  }
});

await test('manual workflow has no migration, deployment, seed or new credentials', () => {
  // This is the repository-owned workflow path, never a supplied filename.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const workflow = readFileSync(
    new URL('../.github/workflows/audit-submissions.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(
    workflow,
    /pull_request:|push:|db:migrate|db:seed|deploy:|wrangler deploy|wrangler login/,
  );
  assert.deepEqual(
    [...workflow.matchAll(/secrets\.([A-Z_]+)/g)]
      .map(match => match[1]!)
      .sort((left, right) => left.localeCompare(right)),
    ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  );
});
