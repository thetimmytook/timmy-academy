import { resolve } from 'node:path';

import { runWrangler } from './run-wrangler.ts';

process.chdir(resolve(import.meta.dirname, '..'));

// Resolve outdir explicitly: Wrangler otherwise resolves it against its config directory.
runWrangler([
  'deploy',
  '--config',
  'infrastructure/wrangler.jsonc',
  '--dry-run',
  '--env=',
  '--outdir',
  resolve('apps/api/dist'),
]);
