import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = '.wrangler/auth-poc-tests';
const config = {
  AUTH_POC_MODE: 'local',
  CLERK_ISSUER: 'https://auth-poc.clerk.accounts.dev',
  CLERK_CLIENT_ID: 'client_fixture',
  CLERK_SECRET_KEY: 'sk_test_fixture',
  CLERK_TEST_SUBJECT: 'user_fixture',
  AUTH_POC_ACCOUNT_ID: 'acc_fixture',
};
const token = {
  object: 'clerk_idp_oauth_access_token',
  subject: config.CLERK_TEST_SUBJECT,
  client_id: config.CLERK_CLIENT_ID,
  scopes: ['email'],
  revoked: false,
  expired: false,
  expiration: Date.now() / 1000 + 3600,
};
const user = {
  id: token.subject,
  banned: false,
  locked: false,
  primary_email_address_id: 'email_fixture',
  email_addresses: [{ id: 'email_fixture', verification: { status: 'verified' } }],
};
let mf: Miniflare;
let tokenReply: unknown;
let userReply: unknown;
let requests: string[];
let redirectProvider = false;

beforeAll(async () => {
  // Only bundle locally. No deployment, Cloudflare login or remote resources.
  await promisify(execFile)(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'deploy',
      '--dry-run',
      '--config',
      'infrastructure/auth-poc/wrangler.jsonc',
      '--outdir',
      `${root}/${output}`,
    ],
    { cwd: root, timeout: 60_000, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
  );
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: `${root}/${output}/worker.js`,

      // Workspace test commands change cwd; keep the bundle inside the module root.
      modulesRoot: `${root}/${output}`,
      compatibilityDate: '2026-09-19',
      bindings: config,
      outboundService: async request => {
        const url = new URL(request.url);
        requests.push(url.href);

        if (redirectProvider) {
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://other.example/' },
          });
        }

        expect(url.origin).toBe('https://api.clerk.com');
        expect(request.headers.get('Authorization')).toBe(`Bearer ${config.CLERK_SECRET_KEY}`);

        if (url.pathname === '/v1/oauth_applications/access_tokens/verify') {
          expect(request.method).toBe('POST');
          expect(await request.json()).toEqual({ access_token: 'fixture-opaque' });

          return Response.json(tokenReply);
        }

        expect(url.pathname).toBe(`/v1/users/${config.CLERK_TEST_SUBJECT}`);

        return Response.json(userReply);
      },
    }),
  );
  await mf.ready;
}, 90_000);

afterAll(async () => {
  await mf?.dispose();
});
beforeEach(() => {
  tokenReply = structuredClone(token);
  userReply = structuredClone(user);
  requests = [];
  redirectProvider = false;
});

const checkUrl = 'http://127.0.0.1:8790/api/auth/v1/poc/check';
const headers = { Authorization: 'Bearer fixture-opaque' };

describe('isolated auth Worker in workerd (stubbed Clerk, no external traffic)', () => {
  it('verifies the credential and primary email without disclosing the private mapping', async () => {
    const response = await mf.dispatchFetch(checkUrl, { headers });
    expect(requests).toEqual([
      'https://api.clerk.com/v1/oauth_applications/access_tokens/verify',
      `https://api.clerk.com/v1/users/${config.CLERK_TEST_SUBJECT}`,
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'verified' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(requests).toHaveLength(2);
  });

  it.each([{ revoked: true }, { expiration: Number.MAX_VALUE }, { client_id: 'other' }])(
    'rejects invalid token evidence in the Worker: %j',
    async override => {
      tokenReply = { ...token, ...override };
      const response = await mf.dispatchFetch(checkUrl, { headers });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ status: 'denied' });
      expect(requests).toHaveLength(1);
    },
  );

  it('rejects a user response with matching null email IDs', async () => {
    userReply = {
      ...user,
      primary_email_address_id: null,
      email_addresses: [{ id: null, verification: { status: 'verified' } }],
    };
    const response = await mf.dispatchFetch(checkUrl, { headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'denied' });
  });

  it('denies anonymous auth checks without contacting Clerk', async () => {
    expect((await mf.dispatchFetch(checkUrl)).status).toBe(401);
    expect(requests).toHaveLength(0);
  });

  it('does not follow provider redirects or forward the secret key', async () => {
    redirectProvider = true;
    const response = await mf.dispatchFetch(checkUrl, { headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'denied' });
    expect(requests).toEqual(['https://api.clerk.com/v1/oauth_applications/access_tokens/verify']);
  });

  it('rejects non-loopback hosts before contacting Clerk', async () => {
    const response = await mf.dispatchFetch(checkUrl.replace('127.0.0.1', 'example.com'), {
      headers,
    });
    expect(response.status).toBe(403);
    expect(requests).toHaveLength(0);
  });
});
