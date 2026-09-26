import type { SubmissionRequest } from '@timmy/contracts';

// The request schema fixes object-key order before this function is called.
export async function submissionFingerprint(request: SubmissionRequest): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(request)),
  );

  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
