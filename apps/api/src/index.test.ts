import { healthResponseSchema } from '@timmy/contracts';
import { describe, expect, it } from 'vitest';

import app from './index';

const healthPath = '/api/bench/v1/health';
describe('health endpoint', () => {
  it('responds with the shared contract', async () => {
    const response = await app.request(healthPath);

    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ status: 'ok' });
  });
});

describe('environment indexing policy', () => {
  it.each([healthPath, '/api/bench/v1/missing', '/api/bench/v1/runs?ram_gb=invalid'])(
    'marks staging API responses including errors as noindex: %s',
    async path => {
      const response = await app.request(path, {}, { DISABLE_INDEXING: 'true' });
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    },
  );
  it.each([{}, { DISABLE_INDEXING: 'false' }])(
    'does not block indexing without staging configuration: %j',
    async bindings => {
      const response = await app.request(healthPath, {}, bindings);
      expect(response.headers.has('X-Robots-Tag')).toBe(false);
    },
  );
});
