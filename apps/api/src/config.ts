export const SUBMISSION_MAX_BODY_BYTES = 32 * 1024;
export const COHORT_QUERY_MAX_BODY_BYTES = 4 * 1024;
export const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
export const SUBMISSION_ACCOUNT_LIMIT = 50;
export const SUBMISSION_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

// Matches the AUTH_RATE_LIMIT binding period in infrastructure/wrangler.jsonc.
export const AUTH_RATE_LIMIT_RETRY_SECONDS = 60;

export const AUTH_POC_REQUEST_TIMEOUT_MS = 5000;
