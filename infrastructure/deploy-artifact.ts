import { checkDatabaseTarget } from './database-config.ts';
import { verifyArtifact } from './deployment-artifact.ts';
import { checkProductionApproval } from './production-approval.ts';
import { runWrangler } from './run-wrangler.ts';

const environment = process.argv[2];
const commitSha = process.env.GITHUB_SHA;
const manifestDigest = process.env.DEPLOYMENT_MANIFEST_SHA256;

if ((environment !== 'staging' && environment !== 'production') || process.argv.length !== 3) {
  throw new Error('Choose staging or production explicitly.');
}

if (!commitSha || !manifestDigest) {
  throw new Error('Deployment requires the build job commit SHA and manifest checksum.');
}

const config = '.wrangler/deployment/wrangler.json';
verifyArtifact('.wrangler/deployment', commitSha, manifestDigest);
checkDatabaseTarget(environment, config);

if (environment === 'production') {
  // Check current rules and actual approval immediately before any database mutation.
  await checkProductionApproval();
}

runWrangler([
  'd1',
  'migrations',
  'apply',
  'BENCHMARK_DB',
  '--config',
  config,
  '--env',
  environment,
  '--remote',
]);
runWrangler(['deploy', '--config', config, '--env', environment, '--no-bundle']);
