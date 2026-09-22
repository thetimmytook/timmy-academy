import { checkDatabaseTarget } from './database-config.ts';
import { runWrangler } from './run-wrangler.ts';

const environment = process.argv[2];

if (
  environment === undefined ||
  !['local', 'staging', 'production'].includes(environment) ||
  process.argv.length !== 3
) {
  throw new Error('Choose local, staging or production explicitly.');
}

checkDatabaseTarget(environment);
runWrangler([
  'd1',
  'migrations',
  'apply',
  'BENCHMARK_DB',
  '--config',
  'infrastructure/wrangler.jsonc',
  ...(environment === 'local' ? ['--local'] : ['--env', environment, '--remote']),
]);
