# Browser authentication in the main API

The main Worker installs a lazy `requirePrincipal` function in the Hono context.
A protected handler calls `await context.get('requirePrincipal')()` before any
owner operation. The result is private and must never be serialized into public
benchmark responses. Public routes do not call Clerk or create accounts. This step
adds no HTTP route or browser sign-in UI.

The API reads runtime bindings once per request through `readConfig` in `config.ts`.
It supplies database, indexing and auth settings without format validation. If any
required auth setting is missing, `config.auth` is unavailable and only handlers
that request a principal fail with a configuration error. JWT and request-origin
checks remain in the auth adapter.

The Clerk Backend SDK accepts browser session cookies or session JWTs in the
Authorization header. The adapter pins the issuer and authorized browser origin,
checks current session status and verified primary email with Clerk, and resolves
the internal account through D1. Desktop opaque tokens are not accepted. An unsafe
HTTP method also requires an Origin header matching `APP_ORIGIN`.

For local development, copy `.dev.vars.example` to `.dev.vars` in this directory.
Set the actual browser origin and Clerk instance values. The product Worker's
existing `BENCHMARK_DB` binding uses the accounts migration already in the main
migration sequence; no second database is required.

For staging and production, configure these bindings independently: `APP_ORIGIN`,
`CLERK_ISSUER`, `CLERK_PUBLISHABLE_KEY`, and secret `CLERK_SECRET_KEY`. Use
`https://staging.timmy.academy` and `https://timmy.academy` respectively as the browser
origins. Do not reuse PoC secrets implicitly. An optional `CLERK_JWT_KEY` can supply
the instance's PEM public key; if configured, it must be updated on key rotation.
Without it the SDK retrieves and caches the instance's JWKS.

Only authentication results within the same HTTP request are reused. Protected
requests check session/user state again, so Clerk availability and two Backend API
reads per successful request are part of the current implementation. Invalid
credentials, inactive sessions and provider failures return a sanitized 401;
configuration and D1 failures return a sanitized 500. Public routes remain usable
without auth configuration. Live browser login and deployment are separate steps.
