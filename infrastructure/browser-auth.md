# Browser and desktop authentication in the main API

The main Worker installs a lazy `requirePrincipal` function in the Hono context.
A protected handler calls `await context.get('requirePrincipal')()` before any
owner operation. The result is private and must never be serialized into public
benchmark responses. Public routes do not call Clerk or create accounts. The owner
list and by-client-ID lookup under `/api/bench/v1/me/runs` require this principal
and create the stable account mapping on the first authenticated owner request.

The main React app provides `/sign-in` and `/sign-up`, including Clerk's verification
subroutes, and current-session logout in the header. Before initializing Clerk,
the SPA fetches same-origin `GET /api/config`. Its explicit public allowlist contains
only `clerkPublishableKey`, sourced from this Worker's `CLERK_PUBLISHABLE_KEY` binding,
or `null` when no key is configured. The main Vite build does not load `.env` files
or embed a Clerk key. The same frontend build can serve both environments.
Failed requests, invalid responses and a five-second timeout disable sign-in while
keeping public browsing available. Sign-in pages show an unavailable message.

`/api/config` returns a `302` with `Cache-Control: no-store` to
`/api/config?version=<SHA-256 of the public JSON>`. The versioned JSON is cached for
one year with `public, max-age=31536000, immutable`, both in the browser and through
the Cloudflare Cache API. Cache keys include the full origin, so staging and production
are separate even if their public keys happen to match. No cookies or authorization
are sent by the SPA's config request, and `mode: 'same-origin'` prevents following
redirects to a different origin. This route never authenticates or reads D1.
If the Cache API fails, the Worker still returns the current public JSON with the
same browser cache policy. The SPA displays its loading status while awaiting config.

To rotate the key, update the environment's `CLERK_PUBLISHABLE_KEY` in
`wrangler.jsonc` and deploy that Worker's configuration. Keep its Clerk instance
settings consistent. Each fresh page load discovers a new versioned URL; clearing
the CDN is unnecessary and would not clear browser caches. An old version requested
from the Worker redirects without caching to the current version, rather than storing
a new key at an old immutable URL. Already-open pages keep their initialized Clerk
instance until reload. Do not configure a CDN rule that caches the discovery redirect.
Only the public JSON is hashed or cached; private auth configuration and ENV are never serialized.

For desktop OAuth, select **OAuth consent page on Account Portal** in the Clerk
instance's component paths. The main application does not expose `/oauth/consent`;
that route belonged to the earlier isolated auth harness. Do not keep a local
`http://127.0.0.1:5190/oauth/consent` consent destination from that harness.
Apply this setting separately to Development and Production. Main-app sign-in
pages preserve the trusted Clerk authorization continuation for desktop OAuth.

Configure email-code sign-in and verified email in the Clerk instance; the widget
uses the instance's enabled authentication methods. Successful sign-in returns to the last benchmark search with its filters,
or `/bench/` when no search is remembered. Browser login alone does not create a D1 account: the first API handler
that requires a principal performs that mapping. The existing public benchmark
routes do not require one.

The API reads runtime bindings once per request through `readConfig` in `read-config.ts`.
It supplies database, indexing and auth settings without format validation. If any
required auth setting is missing, `config.auth` is unavailable and only handlers
that request a principal fail with a configuration error. JWT and request-origin
checks remain in the auth adapter.

The Clerk Backend SDK accepts browser session cookies or session JWTs in the
Authorization header. The adapter pins the issuer and authorized browser origin,
checks current session status and verified primary email with Clerk, and resolves
the internal account through D1. An unsafe browser-authenticated HTTP method also
requires an Origin header matching `APP_ORIGIN`.

The same protected routes accept opaque desktop OAuth access tokens in
`Authorization: Bearer <access_token>`. The deployed Benchmark/Toolkit client must
use **opaque** access tokens; OAuth JWT support is not enabled here. Token shape
only selects a verifier: opaque tokens go to Clerk's online verification endpoint,
and JWTs still require a verified browser session. Malformed or rejected explicit
credentials never fall back to cookies. Public routes remain anonymous.

Desktop verification checks current revocation, expiry, the configured OAuth client,
the `email` scope, and the user's verified primary email and active account state.
It uses the pinned Clerk REST version `2026-05-12`; its token `expiration` field is
Unix seconds, converted to milliseconds for the application principal. See the
[Clerk REST response contract](https://github.com/clerk/openapi-specs/blob/main/bapi/2026-05-12.yml).
The token is sent only in the server-to-Clerk POST body, never a URL or report.

Set `CLERK_DESKTOP_CLIENT_ID` to the public client ID shared by Benchmark and Toolkit
in this environment. `wrangler.jsonc` pins the public IDs in each environment's
`vars`: staging uses the Development Clerk client `33gFOhc9r5yRSe6s`, and production
uses the Production Clerk client `qdlSafxYpIuB7U5x`. These are public identifiers,
not secrets. Local `.dev.vars` values do not configure these deployed bindings.
Changing a Worker binding requires a
backend deployment, not a new Windows package or Microsoft Store submission.

The issuer, publishable key, server secret key and OAuth client
must all belong to the same Clerk instance. The OAuth client has no client secret;
the existing `CLERK_SECRET_KEY` stays server-only. Browser auth still works if the
desktop client ID is absent; desktop requests then fail with a configuration error.
Use `email offline_access`, public-client PKCE and the existing loopback callback
configuration in the Windows applications. No new login or exchange endpoint is
introduced in Academy, and product code does not depend on the desktop PoC.

Desktop requests do not require Origin; if present it must match `APP_ORIGIN`.
Their principal always has `session.kind = desktop` and `canModerate = false`, even
for a Clerk admin user. Admin routes additionally require a browser principal.
Both adapters resolve the same `(issuer, subject)` through the existing D1 account
repository, never through email. Desktop credentials and browser sessions remain
separate; logging out of one does not log out of the other.

For local development, copy `.dev.vars.example` to `.dev.vars` in this directory.
Set the actual browser origin and Clerk instance values. The product Worker's
existing `BENCHMARK_DB` binding uses the accounts migration already in the main
migration sequence; no second database is required.

For staging and production, `infrastructure/wrangler.jsonc` is the source of truth
for public runtime bindings: `APP_ORIGIN`, `CLERK_DESKTOP_CLIENT_ID`, `CLERK_ISSUER`
and `CLERK_PUBLISHABLE_KEY`. `DISABLE_INDEXING` is set only in staging. Keep these
values in each environment's `vars` so deployments preserve the configuration;
local `.dev.vars` and manual Dashboard changes are not the deployment source.
Missing issuer or publishable key disables API auth configuration and causes
protected endpoints to return 500 even if browser sign-in works.

The main frontend no longer consumes `STAGING_CLERK_PUBLISHABLE_KEY`,
`PRODUCTION_CLERK_PUBLISHABLE_KEY` or `VITE_CLERK_PUBLISHABLE_KEY`.
The Worker's runtime binding supplies its key through `/api/config`.
`deployment-config.test.ts` reads the checked-in JSONC
directly, independently of `.dev.vars`; it does not query GitHub or Cloudflare.

`CLERK_SECRET_KEY` and `BENCHMARK_CURSOR_SECRET` remain exclusively in Cloudflare
Secrets for each deployed environment. Never add their values to Wrangler `vars`,
frontend build variables, tests or documentation. Do not reuse PoC secrets
implicitly. An optional `CLERK_JWT_KEY` can supply
the instance's PEM public key; if configured, it must be updated on key rotation.
Without it the SDK retrieves and caches the instance's JWKS.

Only authentication results within the same HTTP request are reused. Protected
requests check session/token and user state again, so Clerk availability and two
Backend API calls per successful request are part of the current implementation. Invalid
credentials, inactive sessions and provider failures return a sanitized 401;
configuration and D1 failures return a sanitized 500. Public routes remain usable
without auth configuration. Live browser login and deployment are separate steps.
