/* eslint-disable security/detect-non-literal-fs-filename -- Paths belong to the build artifact or GitHub's output file, never HTTP input. */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { parse } from 'jsonc-parser';

const artifactDirectory = '.wrangler/deployment';
const manifestName = 'manifest.json';

interface ArtifactManifest {
  commitSha: string;
  nodeVersion: string;
  wranglerVersion: string;
  files: { path: string; sha256: string }[];
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function artifactFiles(directory: string): ArtifactManifest['files'] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => {
      if (!entry.isFile() && !entry.isDirectory()) {
        throw new Error('Deployment artifacts must contain only regular files and directories.');
      }

      return entry.isFile() && join(entry.parentPath, entry.name) !== join(directory, manifestName);
    })
    .map(entry => {
      const filename = join(entry.parentPath, entry.name);

      return {
        path: relative(directory, filename).split(sep).join('/'),
        sha256: digest(readFileSync(filename)),
      };
    })
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

export function packageArtifact(commitSha: string): string {
  mkdirSync('.wrangler', { recursive: true });

  // Never merge a previous build into a new artifact.
  mkdirSync(artifactDirectory);
  cpSync('apps/web/dist', join(artifactDirectory, 'assets'), { recursive: true });
  cpSync('apps/api/dist', join(artifactDirectory, 'worker'), { recursive: true });
  cpSync('infrastructure/migrations', join(artifactDirectory, 'migrations'), { recursive: true });

  const config = parse(readFileSync('infrastructure/wrangler.jsonc', 'utf8')) as {
    $schema?: string;
    build?: unknown;
    no_bundle?: boolean;
    main: string;
    assets: { directory: string };
  };
  delete config.$schema;
  delete config.build;
  config.no_bundle = true;
  config.main = './worker/index.js';
  config.assets.directory = './assets';
  writeFileSync(join(artifactDirectory, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');

  const wrangler = JSON.parse(readFileSync('node_modules/wrangler/package.json', 'utf8')) as {
    version: string;
  };
  const manifest: ArtifactManifest = {
    commitSha,
    nodeVersion: process.version,
    wranglerVersion: wrangler.version,
    files: artifactFiles(artifactDirectory),
  };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(join(artifactDirectory, manifestName), json);

  return digest(json);
}

export function verifyArtifact(directory: string, commitSha: string, manifestDigest: string): void {
  const json = readFileSync(join(directory, manifestName), 'utf8');

  if (digest(json) !== manifestDigest) {
    throw new Error('Deployment manifest checksum does not match the build job.');
  }

  const manifest = JSON.parse(json) as ArtifactManifest;
  const wrangler = JSON.parse(readFileSync('node_modules/wrangler/package.json', 'utf8')) as {
    version: string;
  };

  if (manifest.commitSha !== commitSha || manifest.wranglerVersion !== wrangler.version) {
    throw new Error('Deployment artifact must match this commit and the locked Wrangler version.');
  }

  if (JSON.stringify(manifest.files) !== JSON.stringify(artifactFiles(directory))) {
    throw new Error('Deployment artifact files were changed, added or removed after build.');
  }
}

if (import.meta.main) {
  const commitSha = process.env.GITHUB_SHA;
  const output = process.env.GITHUB_OUTPUT;

  if (!commitSha || !output) {
    throw new Error(
      'Package the deployment artifact in the build job with GITHUB_SHA and GITHUB_OUTPUT.',
    );
  }

  const manifestDigest = packageArtifact(commitSha);
  writeFileSync(output, `manifest-sha256=${manifestDigest}\n`, { flag: 'a' });
}
