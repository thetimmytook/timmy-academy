import { checkDatabaseTarget } from './database-config.mjs';
import { runWrangler } from './run-wrangler.mjs';

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
