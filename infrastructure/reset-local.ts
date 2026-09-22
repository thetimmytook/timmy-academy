import { checkDatabaseTarget } from './database-config.ts';
import { runWrangler } from './run-wrangler.ts';

checkDatabaseTarget('local');
runWrangler([
  'd1',
  'execute',
  'BENCHMARK_DB',
  '--config',
  'infrastructure/wrangler.jsonc',
  '--file',
  'infrastructure/reset-local.sql',
  '--local',
]);
