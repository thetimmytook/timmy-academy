import { z } from 'zod';

export * from './benchmark.js';

export const healthResponseSchema = z.object({ status: z.literal('ok') });

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export * from './owner-runs.js';
export * from './settings-snapshot.js';
export * from './submission.js';
export * from './limits.js';
