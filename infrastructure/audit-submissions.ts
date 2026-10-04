import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

import { parse } from 'jsonc-parser';

import { parseAuditOutput, submissionAuditQuery } from './audit-submissions-query.ts';
import { checkDatabaseTarget } from './database-config.ts';

try {
  const environment = process.env.AUDIT_ENVIRONMENT;
  const ownerRunId = process.env.AUDIT_OWNER_RUN_ID;

  if ((environment !== 'staging' && environment !== 'production') || !ownerRunId) {
    throw new Error('An explicit remote environment and owner run are required.');
  }

  checkDatabaseTarget(environment);
  const config = parse(readFileSync('infrastructure/wrangler.jsonc', 'utf8')) as {
    env: {
      staging: { vars: { CLERK_ISSUER: string } };
      production: { vars: { CLERK_ISSUER: string } };
    };
  };
  const target = environment === 'production' ? config.env.production : config.env.staging;
  const query = submissionAuditQuery(ownerRunId, target.vars.CLERK_ISSUER);
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
      query,
      '--json',
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 60000,
      env: {
        ...process.env,
        CI: 'true',
        WRANGLER_SEND_METRICS: 'false',
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
      },
    },
  );

  // Raw Wrangler output can contain account/database IDs or native errors.
  // Only the validated aggregate allowlist is ever written to logs or summaries.
  if (result.error || result.status !== 0) {
    throw new Error('Remote query failed.');
  }

  const report = `Environment: ${environment}\n\n` + parseAuditOutput(result.stdout);
  process.stdout.write(report);
  const summary = process.env.GITHUB_STEP_SUMMARY;

  if (summary) {
    // GitHub provides this runner-owned summary path.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    appendFileSync(summary, report);
  }
} catch {
  console.error(
    'Audit unavailable: query, credentials or verified owner mapping could not be established. Raw output was withheld; this is not a zero-submission result.',
  );
  process.exitCode = 1;
}
