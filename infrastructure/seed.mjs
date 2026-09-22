import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { seedStatements } from '../apps/api/src/benchmark/seed.ts';

import { checkDatabaseTarget } from './database-config.mjs';
import { runWrangler } from './run-wrangler.mjs';

const environment = process.argv[2];
if (
  environment === undefined ||
  !['local', 'staging'].includes(environment) ||
  process.argv.length !== 3
)
  throw new Error(
    'Seed supports only an explicit local or staging target. Production is forbidden.',
  );
checkDatabaseTarget(environment);
const output = resolve('infrastructure/.wrangler/seed.sql');
mkdirSync(resolve('infrastructure/.wrangler'), { recursive: true });
writeFileSync(output, seedStatements().join('\n'));
const args = [
  'd1',
  'execute',
  'BENCHMARK_DB',
  '--config',
  'infrastructure/wrangler.jsonc',
  '--file',
  output,
  ...(environment === 'local' ? ['--local'] : ['--env', 'staging', '--remote']),
];
runWrangler(args);
