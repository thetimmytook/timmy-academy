import { readFileSync } from 'node:fs';

import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

import type { ParseError } from 'jsonc-parser';

type EnvironmentVariables = {
  APP_ORIGIN: string;
  CLERK_DESKTOP_CLIENT_ID: string;
  CLERK_ISSUER: string;
  CLERK_PUBLISHABLE_KEY: string;
  DISABLE_INDEXING?: string;
};
type DeploymentConfig = {
  env: {
    staging: { vars: EnvironmentVariables };
    production: { vars: EnvironmentVariables };
  };
};

// Inspect the deployment file itself, not .dev.vars or synthetic auth bindings.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const source = readFileSync(
  new URL('../../../infrastructure/wrangler.jsonc', import.meta.url),
  'utf8',
);
const errors: ParseError[] = [];
const parsed: unknown = parse(source, errors, { allowTrailingComma: true });
const config = parsed as DeploymentConfig;

describe('deployed public authentication configuration', () => {
  it('uses valid JSONC', () => {
    expect(errors).toEqual([]);
  });

  it.each([
    {
      name: 'staging',
      vars: config.env.staging.vars,
      expected: {
        APP_ORIGIN: 'https://staging.timmy.academy',
        CLERK_DESKTOP_CLIENT_ID: '33gFOhc9r5yRSe6s',
        CLERK_ISSUER: 'https://guiding-seagull-5578.clerk.accounts.dev',
        CLERK_PUBLISHABLE_KEY: 'pk_test_Z3VpZGluZy1zZWFndWxsLTU1NzguY2xlcmsuYWNjb3VudHMuZGV2JA',
        DISABLE_INDEXING: 'true',
      },
    },
    {
      name: 'production',
      vars: config.env.production.vars,
      expected: {
        APP_ORIGIN: 'https://timmy.academy',
        CLERK_DESKTOP_CLIENT_ID: 'qdlSafxYpIuB7U5x',
        CLERK_ISSUER: 'https://clerk.timmy.academy',
        CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsudGltbXkuYWNhZGVteSQ',
      },
    },
  ])('pins only the expected public runtime variables for $name', deployment => {
    // Exact equality also excludes secret bindings and production DISABLE_INDEXING.
    expect(deployment.vars).toEqual(deployment.expected);
  });
});
