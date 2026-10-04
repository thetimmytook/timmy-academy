import { z } from 'zod';

// Explicit public allowlist. Worker bindings and private auth configuration are never serialized.
export const publicConfigSchema = z.strictObject({
  clerkPublishableKey: z.string().min(1).nullable(),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;
