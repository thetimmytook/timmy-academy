import { readFileSync } from 'node:fs';

import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

import type { ParseError } from 'jsonc-parser';

type EnvironmentVariables = {
  APP_ORIGIN: string;
  CLERK_DESKTOP_CLIENT_ID: string;
};
type DeploymentConfig = {
  env: {
    staging: { vars: EnvironmentVariables };
    production: { vars: EnvironmentVariables };
  };
};

// Inspect the deployment file itself, not .dev.vars or synthetic auth bindings.
const errors: ParseError[] = [];
const parsed: unknown = parse(
  readFileSync(new URL('../../../infrastructure/wrangler.jsonc', import.meta.url), 'utf8'),
  errors,
  { allowTrailingComma: true },
);
const config = parsed as DeploymentConfig;

describe('deployed desktop OAuth configuration', () => {
  it('uses valid JSONC', () => {
    expect(errors).toEqual([]);
  });

  it.each([
    {
      name: 'staging',
      vars: config.env.staging.vars,
      origin: 'https://staging.timmy.academy',
      clientId: '33gFOhc9r5yRSe6s',
    },
    {
      name: 'production',
      vars: config.env.production.vars,
      origin: 'https://timmy.academy',
      clientId: 'qdlSafxYpIuB7U5x',
    },
  ])('pins the origin and matching desktop client for $name', deployment => {
    expect(deployment.vars.APP_ORIGIN).toBe(deployment.origin);
    expect(deployment.vars.CLERK_DESKTOP_CLIENT_ID).toBe(deployment.clientId);
  });
});
