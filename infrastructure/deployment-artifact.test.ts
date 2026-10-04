/* eslint-disable security/detect-non-literal-fs-filename -- Fixture files stay inside the freshly created test directory. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { parse } from 'jsonc-parser';

import { packageArtifact, verifyArtifact } from './deployment-artifact.ts';

const repository = process.cwd();
const commitSha = 'a'.repeat(40);
const artifact = '.wrangler/deployment';
const artifactConfig = artifact + '/wrangler.json';
const sourceConfig = 'infrastructure/wrangler.jsonc';
const deployScript = resolve(repository, 'infrastructure/deploy-artifact.ts');
const commandsFile = 'commands.jsonl';
let directory: string;
let checksum: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'academy-artifact-'));
  mkdirSync(join(directory, 'apps/web/dist'), { recursive: true });
  mkdirSync(join(directory, 'apps/api/dist'), { recursive: true });
  mkdirSync(join(directory, 'infrastructure'), { recursive: true });
  mkdirSync(join(directory, 'node_modules/wrangler/bin'), { recursive: true });
  writeFileSync(join(directory, 'apps/web/dist/index.html'), '<p>Public benchmarks</p>');
  writeFileSync(join(directory, 'apps/api/dist/index.js'), 'export default {};');
  cpSync(join(repository, sourceConfig), join(directory, sourceConfig));
  cpSync(
    join(repository, 'infrastructure/migrations'),
    join(directory, 'infrastructure/migrations'),
    { recursive: true },
  );
  cpSync(
    join(repository, 'node_modules/wrangler/package.json'),
    join(directory, 'node_modules/wrangler/package.json'),
  );

  // A local recorder substitutes for Wrangler; these tests never contact Cloudflare.
  writeFileSync(
    join(directory, 'node_modules/wrangler/bin/wrangler.js'),
    "require('node:fs').appendFileSync('commands.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');",
  );
  process.chdir(directory);
  checksum = packageArtifact(commitSha);
});

afterEach(() => {
  process.chdir(repository);
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.match(basename(directory), /^academy-artifact-/);
  rmSync(directory, { recursive: true, force: true });
});

await test('packages relocatable assets, Worker, migrations and unchanged environment bindings', () => {
  verifyArtifact(artifact, commitSha, checksum);
  const source: unknown = parse(readFileSync(sourceConfig, 'utf8'));
  const config = JSON.parse(readFileSync(artifactConfig, 'utf8')) as Record<string, unknown>;
  const expected = source as typeof config;
  delete expected.$schema;
  delete expected.build;
  expected.no_bundle = true;
  expected.main = './worker/index.js';
  expected.assets = { ...(expected.assets as Record<string, unknown>), directory: './assets' };
  assert.deepEqual(config, expected);
  assert.ok(existsSync(artifact + '/migrations/meta/_journal.json'));
});

await test('refuses another SHA, changed manifest, modified files and extra files', () => {
  assert.throws(() => verifyArtifact(artifact, 'b'.repeat(40), checksum), /commit/);
  assert.throws(() => verifyArtifact(artifact, commitSha, 'wrong-checksum'), /checksum/);
  writeFileSync(artifact + '/worker/index.js', 'changed');
  assert.throws(() => verifyArtifact(artifact, commitSha, checksum), /changed/);
  writeFileSync(artifact + '/worker/index.js', 'export default {};');
  writeFileSync(artifact + '/assets/unexpected.txt', 'unexpected');
  assert.throws(() => verifyArtifact(artifact, commitSha, checksum), /changed/);
});

await test('staging migrates its own database before deploying the built Worker without bundling', () => {
  const result = spawnSync(process.execPath, [deployScript, 'staging'], {
    encoding: 'utf8',
    env: { GITHUB_SHA: commitSha, DEPLOYMENT_MANIFEST_SHA256: checksum },
  });
  assert.equal(result.status, 0, result.stderr);
  const commands = readFileSync(commandsFile, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as string[]);
  assert.deepEqual(commands, [
    [
      'd1',
      'migrations',
      'apply',
      'BENCHMARK_DB',
      '--config',
      artifactConfig,
      '--env',
      'staging',
      '--remote',
    ],
    ['deploy', '--config', artifactConfig, '--env', 'staging', '--no-bundle'],
  ]);
});

await test('production with no verifiable approval cannot run migrations or deploy', () => {
  const result = spawnSync(process.execPath, [deployScript, 'production'], {
    encoding: 'utf8',
    env: { GITHUB_SHA: commitSha, DEPLOYMENT_MANIFEST_SHA256: checksum },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required to verify production approval/);
  assert.equal(existsSync(commandsFile), false);
});

await test('an altered artifact stops before any database mutation', () => {
  writeFileSync(artifact + '/migrations/unreviewed.sql', 'SELECT 1;');
  const result = spawnSync(process.execPath, [deployScript, 'staging'], {
    encoding: 'utf8',
    env: { GITHUB_SHA: commitSha, DEPLOYMENT_MANIFEST_SHA256: checksum },
  });
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(commandsFile), false);
});
