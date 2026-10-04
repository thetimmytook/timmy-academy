import { publicConfigSchema } from '@timmy/contracts';

import type { PublicConfig } from '@timmy/contracts';

export async function loadConfig(): Promise<PublicConfig> {
  try {
    // The no-store discovery URL redirects to an immutable, origin-specific version.
    const response = await fetch('/api/config', {
      credentials: 'omit',
      mode: 'same-origin',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { clerkPublishableKey: null };
    }

    return publicConfigSchema.parse(await response.json());
  } catch {
    // Public benchmarks remain usable when configuration is unavailable or invalid.
    return { clerkPublishableKey: null };
  }
}
