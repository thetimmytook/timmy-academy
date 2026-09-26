import type {
  FilterOptions,
  CohortQuery,
  CohortResponse,
  PublicRunDetail,
  RunSearchQuery,
  RunSearchResponse,
} from '@timmy/contracts';

export interface BenchmarkRepository {
  filterOptions(): Promise<FilterOptions>;
  search(query: RunSearchQuery): Promise<RunSearchResponse>;
  detail(id: string): Promise<PublicRunDetail | undefined>;
  cohort(query: CohortQuery): Promise<CohortResponse>;
}

const errors = {
  not_owner: { status: 403, message: 'This publication belongs to another account.' },
  publication_deleted: {
    status: 409,
    message: 'This publication was deleted and cannot be resubmitted with the same client run ID.',
  },
  idempotency_conflict: {
    status: 409,
    message: 'This local run ID was already submitted with different data.',
  },
  invalid_input: { status: 422, message: 'The benchmark request is invalid.' },
  unsupported_media_type: { status: 415, message: 'Use application/json for this request.' },
  payload_too_large: { status: 413, message: 'The benchmark request body exceeds the size limit.' },
  not_found: { status: 404, message: 'The requested run or group was not found.' },
  invalid_cursor: { status: 400, message: 'The search cursor is invalid.' },
  cursor_stale: { status: 409, message: 'Search results changed. Start from the first page.' },
  group_key_stale: {
    status: 409,
    message: 'The hardware group is no longer available. Start from the first page.',
  },
} as const;
const errorsByCode = new Map(Object.entries(errors));

export class BenchmarkRequestError extends Error {
  readonly status;
  constructor(readonly code: keyof typeof errors) {
    const error = errorsByCode.get(code);

    if (!error) {
      throw new Error('Unknown benchmark error code.');
    }

    super(error.message);
    this.status = error.status;
  }
}
