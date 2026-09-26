import { z } from 'zod';

import { publicRunDetailSchema } from './benchmark.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './limits.js';

export const moderationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  after: z.coerce.number().int().positive().optional(),
});
export const moderationRunSchema = publicRunDetailSchema.omit({ public_run_id: true, url: true });
export const moderationQueueSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      submission_id: z.number().int().positive(),
      submitted_at: z.iso.datetime(),
      run: moderationRunSchema,
    }),
  ),
  next_after: z.number().int().positive().nullable(),
});
export type ModerationQuery = z.infer<typeof moderationQuerySchema>;
export type ModerationQueue = z.infer<typeof moderationQueueSchema>;
export const moderationDecisionSchema = z.enum(['approve', 'reject']);
export const moderationDecisionResponseSchema = z.strictObject({
  submission_id: z.number().int().positive(),
  publication_status: z.enum(['published', 'rejected']),
});
export type ModerationDecision = z.infer<typeof moderationDecisionSchema>;
