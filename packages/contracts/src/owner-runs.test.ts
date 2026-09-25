import { describe, expect, it } from 'vitest';

import { deletedOwnerRunSchema, ownerRunsQuerySchema } from './owner-runs';

describe('owner read contracts', () => {
  it('parses HTTP defaults and bounded page sizes', () => {
    expect(ownerRunsQuerySchema.parse({})).toEqual({ status: 'all', limit: 20 });
    expect(ownerRunsQuerySchema.parse({ status: 'rejected', limit: '50' })).toEqual({
      status: 'rejected',
      limit: 50,
    });
  });

  it.each([
    { limit: '1.5' },
    { limit: '-1' },
    { limit: '1e1' },
    { accountId: 'foreign' },
    { status: 'deleted' },
  ])('rejects ambiguous or unsupported query fields: %j', query => {
    expect(ownerRunsQuerySchema.safeParse(query).success).toBe(false);
  });

  it('keeps deletion acknowledgements minimal and requires UUID client IDs', () => {
    const marker = {
      client_run_id: '00000000-0000-4000-8000-000000000001',
      publication_status: 'deleted',
      public_run_id: null,
      url: null,
    };
    expect(deletedOwnerRunSchema.safeParse(marker).success).toBe(true);
    expect(deletedOwnerRunSchema.safeParse({ ...marker, detail: {} }).success).toBe(false);
    expect(deletedOwnerRunSchema.safeParse({ ...marker, client_run_id: 'invalid' }).success).toBe(
      false,
    );
  });
});
