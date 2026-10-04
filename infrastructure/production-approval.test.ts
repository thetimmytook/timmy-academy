import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { checkProductionApproval, requireProductionReviewers } from './production-approval.ts';

const environment = {
  id: 42,
  protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }],
};

// Node's test runner gives this file its own process; only synthetic credentials are used.
beforeEach(() => {
  process.env.GH_TOKEN = 'synthetic-test-token';
  process.env.GITHUB_REPOSITORY = 'fixture/academy';
  process.env.GITHUB_API_URL = 'https://api.github.test';
  process.env.GITHUB_RUN_ID = '123';
});

await test('preflight requires nonempty Required reviewers, not a wait timer', async context => {
  for (const protection_rules of [
    [],
    [{ type: 'wait_timer' }],
    [{ type: 'required_reviewers', reviewers: [] }],
  ]) {
    const fetch = context.mock.method(globalThis, 'fetch', () =>
      Promise.resolve(Response.json({ id: 42, protection_rules })),
    );
    await assert.rejects(requireProductionReviewers(), /Required reviewers/);
    fetch.mock.restore();
  }
});

await test('missing environment and denied API access fail closed', async context => {
  for (const status of [403, 404, 500]) {
    const fetch = context.mock.method(globalThis, 'fetch', () =>
      Promise.resolve(new Response(null, { status })),
    );
    await assert.rejects(requireProductionReviewers(), /Cannot verify production approval/);
    fetch.mock.restore();
  }
});

await test('requires actual approval for this run and this production environment', async context => {
  for (const reviews of [
    [],
    [{ state: 'rejected', environments: [{ id: 42 }] }],
    [{ state: 'approved', environments: [{ id: 99 }] }],
  ]) {
    const fetch = context.mock.method(globalThis, 'fetch', (url: string) =>
      Promise.resolve(Response.json(url.endsWith('/production') ? environment : reviews)),
    );
    await assert.rejects(checkProductionApproval(), /no manual approval/);
    assert.equal(
      fetch.mock.calls[1]?.arguments[0],
      'https://api.github.test/repos/fixture/academy/actions/runs/123/approvals',
    );
    fetch.mock.restore();
  }
});

await test('preflight succeeds without claiming approval; approved run requires both checks', async context => {
  const fetch = context.mock.method(globalThis, 'fetch', (url: string) =>
    Promise.resolve(
      Response.json(
        url.endsWith('/production')
          ? environment
          : [{ state: 'approved', environments: [{ id: 42 }] }],
      ),
    ),
  );
  await requireProductionReviewers();
  assert.equal(fetch.mock.callCount(), 1);
  await checkProductionApproval();
  assert.equal(fetch.mock.callCount(), 3);
});

await test('does not trust malformed metadata or a network failure', async context => {
  const fetch = context.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(Response.json({ protection_rules: environment.protection_rules })),
  );
  await assert.rejects(requireProductionReviewers());
  fetch.mock.restore();
  context.mock.method(globalThis, 'fetch', () => Promise.reject(new Error('offline')));
  await assert.rejects(checkProductionApproval(), /offline/);
});

await test('removed protection rules cannot reuse a previous approval', async context => {
  const fetch = context.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(Response.json({ id: 42, protection_rules: [] })),
  );
  await assert.rejects(checkProductionApproval(), /Required reviewers/);
  assert.equal(fetch.mock.callCount(), 1);
});
