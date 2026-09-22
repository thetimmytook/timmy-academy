import { Hono } from 'hono';
import { z } from 'zod';

import { registerAuthPocApi } from './auth-poc.api';
import { createClerkTestAdapter } from './clerk-adapter';

const bindingsSchema = z.object({
  AUTH_POC_MODE: z.literal('local'),
  CLERK_ISSUER: z.string().min(1),
  CLERK_CLIENT_ID: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_TEST_SUBJECT: z.string().min(1),
  AUTH_POC_ACCOUNT_ID: z.string().min(1),
});

function unavailable(status: 403 | 503): Response {
  return Response.json(
    { status: 'unavailable' },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
  );
}

/** Separate local harness; never imported by the product Worker. */
export default {
  async fetch(request: Request, bindings: unknown): Promise<Response> {
    const url = new URL(request.url);

    // Defence in depth; Wrangler also binds the server to loopback only.
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      return unavailable(403);
    }

    try {
      const config = bindingsSchema.parse(bindings);
      const adapter = createClerkTestAdapter(
        {
          issuer: config.CLERK_ISSUER,
          clientId: config.CLERK_CLIENT_ID,
          secretKey: config.CLERK_SECRET_KEY,
        },
        {
          // One explicitly provisioned private mapping; no email lookup or account creation.
          findAccount: (issuer, subject) =>
            Promise.resolve(
              issuer === config.CLERK_ISSUER && subject === config.CLERK_TEST_SUBJECT
                ? config.AUTH_POC_ACCOUNT_ID
                : null,
            ),
        },
      );
      const app = new Hono();
      registerAuthPocApi(app, adapter);
      app.notFound(() => unavailable(403));
      app.onError(() => unavailable(503));

      return await app.fetch(request);
    } catch {
      // Configuration and provider details must not enter responses or logs.
      return unavailable(503);
    }
  },
};
