import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { demoSeedStatements } from '../apps/api/src/benchmark/demo-seed.ts';

import { checkDatabaseTarget } from './database-config.ts';
import { runWrangler } from './run-wrangler.ts';

const environment = process.argv[2];
const isGenerateOnly = process.argv.length === 4 && process.argv[3] === '--generate-only';

if (
  environment === undefined ||
  !['local', 'staging', 'production'].includes(environment) ||
  (process.argv.length !== 3 && !isGenerateOnly)
) {
  throw new Error(
    'Demo seed requires a local, staging or production target and optional --generate-only.',
  );
}

checkDatabaseTarget(environment);
const statements = demoSeedStatements();
const output = resolve(`infrastructure/.wrangler/demo-seed-${environment}.sql`);
mkdirSync(resolve('infrastructure/.wrangler'), { recursive: true });

// Fixed workspace directory; environment is restricted to the three targets above.
// eslint-disable-next-line security/detect-non-literal-fs-filename
writeFileSync(output, statements.join('\n'));
console.log(`Prepared ${statements.length} demo insert/telemetry-update statements: ${output}`);

if (!isGenerateOnly) {
  console.log(`Applying demo inserts and telemetry updates to ${environment}.`);
  runWrangler([
    'd1',
    'execute',
    'BENCHMARK_DB',
    '--config',
    'infrastructure/wrangler.jsonc',
    '--file',
    output,
    ...(environment === 'local' ? ['--local'] : ['--env', environment, '--remote']),
  ]);
}
