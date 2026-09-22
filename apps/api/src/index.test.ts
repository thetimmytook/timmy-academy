import { healthResponseSchema } from '@timmy/contracts';
import { describe, expect, it } from 'vitest';

import app from './index';

describe('health endpoint', () => {
  it('responds with the shared contract', async () => {
    const response = await app.request('/api/bench/v1/health');

    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ status: 'ok' });
  });
});
