import { z } from 'zod';

import {
  executionSchema,
  namedModelSchema,
  publicRunIdSchema,
  resolutionSchema,
  summaryMetricsSchema,
} from './benchmark.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './limits.js';
import { resourceTelemetrySummarySchema } from './resource-telemetry.js';

export const clientRunIdSchema = z.uuid();
export const deletePublicationResponseSchema = z.strictObject({
  publication_status: z.literal('deleted'),
  public_run_id: publicRunIdSchema,
});
export const ownerRunsQuerySchema = z.strictObject({
  status: z.enum(['all', 'published', 'pending_review', 'rejected']).default('all'),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(MAX_PAGE_SIZE))
    .default(DEFAULT_PAGE_SIZE),
  cursor: z.string().optional(),
});
const fields = {
  client_run_id: clientRunIdSchema,
  submitted_at: z.iso.datetime(),
  captured_day: z.iso.date(),
  hardware: z.strictObject({
    cpu: z.string().min(1),
    gpu: z.string().min(1),
    ram_gb: z.number().int().positive(),
  }),
  map: namedModelSchema,
  execution: executionSchema,
  game_resolution: resolutionSchema.nullable(),
  metrics: summaryMetricsSchema,
  resource_telemetry: resourceTelemetrySummarySchema,
};
export const ownerRunSchema = z.discriminatedUnion('publication_status', [
  z.strictObject({
    ...fields,
    publication_status: z.literal('published'),
    public_run_id: publicRunIdSchema,
    url: z.string().regex(/^\/bench\/runs\/br_[A-Za-z0-9_-]+$/),
    status_reason: z.null(),
  }),
  z.strictObject({
    ...fields,
    publication_status: z.literal('pending_review'),
    public_run_id: z.null(),
    url: z.null(),
    status_reason: z.null(),
  }),
  z.strictObject({
    ...fields,
    publication_status: z.literal('rejected'),
    public_run_id: z.null(),
    url: z.null(),
    status_reason: z.literal('rejected'),
  }),
]);
export const deletedOwnerRunSchema = z.strictObject({
  client_run_id: clientRunIdSchema,
  publication_status: z.literal('deleted'),
  public_run_id: z.null(),
  url: z.null(),
});
export const ownerRunsResponseSchema = z.strictObject({
  status_filter: z.enum(['all', 'published', 'pending_review', 'rejected']),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
  items: z.array(ownerRunSchema),
  next_cursor: z
    .string()
    .regex(/^own_[A-Za-z0-9_-]+$/)
    .nullable(),
});
export const ownerRunLookupSchema = z.strictObject({
  item: z.union([ownerRunSchema, deletedOwnerRunSchema]),
});
export type OwnerRunsQuery = z.infer<typeof ownerRunsQuerySchema>;
