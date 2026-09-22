import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from './index';

describe('health response contract', () => {
  it('accepts the documented response', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });
});
