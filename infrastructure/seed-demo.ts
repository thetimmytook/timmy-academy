import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { demoSeedStatements } from '../apps/api/src/benchmark/demo-seed.ts';

import { checkDatabaseTarget } from './database-config.ts';
import { runWrangler } from './run-wrangler.ts';

const environment = process.argv[2];

if (
  environment === undefined ||
  !['local', 'staging', 'production'].includes(environment) ||
  process.argv.length !== 3
) {
  throw new Error('Demo seed requires an explicit local, staging or production target.');
}

checkDatabaseTarget(environment);
const statements = demoSeedStatements();
const output = resolve(`infrastructure/.wrangler/demo-seed-${environment}.sql`);
mkdirSync(resolve('infrastructure/.wrangler'), { recursive: true });

// Fixed workspace directory; environment is restricted to the three targets above.
// eslint-disable-next-line security/detect-non-literal-fs-filename
writeFileSync(output, statements.join('\n'));
console.log(`Seeding ${statements.length} demo measurements into ${environment}.`);
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
