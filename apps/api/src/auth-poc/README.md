# Auth provider proof: adapter, local Worker and browser harness

Review checkpoint, 2026-09-22. Clerk remains a candidate, not a selected provider.
This directory is not imported by the product Worker, web app or Windows apps.
It has a separate local Worker configuration, but no deployment environments,
account provisioning or run publication.
The API declares Zod directly for the small provider-response schemas.

## What this step proves

The adapter uses the Clerk REST API behind a provider-independent `AuthAdapter`.
It accepts only opaque desktop credentials, verifies each request remotely, pins the
OAuth client, rejects expiry/revocation, and separately checks the user's verified
primary email and blocked state. A private `(issuer, subject)` lookup supplies the
application account ID. The directory intentionally has no email lookup or automatic
account creation. The configured test key must belong to the configured test issuer;
this association must be checked with a live instance before claiming issuer validation.

The isolated route returns only `verified` or `denied`, disables caching, does not log,
and discards provider error details. An upstream outage currently produces denial
just like an invalid credential; operational error classification is outside this step.
There is no positive verification cache, so each accepted request costs two Backend
API requests. Rate limits, latency and availability need live measurement.

Run from the repository root:

```sh
npx vitest run apps/api/src/auth-poc
npm run typecheck -w @timmy/api
npx eslint apps/api/src/auth-poc
npx prettier --check apps/api/src/auth-poc
```

Tests use synthetic responses and identities. The runtime tests bundle the actual
Worker with Wrangler's `deploy --dry-run` (no upload), then run it in local workerd
through Miniflare. All outbound fetches are intercepted by an in-process Clerk stub;
the tests never call the live provider. Build output stays in ignored `.wrangler/`.

Local verification on 2026-09-22: **90/90 PoC tests passed**, including malformed
provider responses, missing/null primary-email IDs and overflow when converting expiry
to milliseconds. API TypeScript, targeted ESLint and Prettier checks passed.
Eight of these cases run the actual Worker bundle. This exposed a runtime restriction:
workerd rejects `redirect: 'error'`. The adapter now uses `manual` and rejects non-2xx
responses. A runtime test verifies that a provider redirect is denied without forwarding
the secret key to its target. The earlier full API baseline passed 132 tests before
these additional PoC cases.

## Local Worker

The dedicated configuration is `infrastructure/auth-poc/wrangler.jsonc`. It has no
product assets, database bindings, routes or production environment. It binds to
`127.0.0.1:8790`, disables observability, workers.dev and preview URLs. Nothing here
authorizes deployment. The Worker additionally requires `AUTH_POC_MODE=local` and
a loopback request hostname. These are local-harness guards, not a production access policy.

Once the browser/desktop harness is ready, copy `.dev.vars.example` to `.dev.vars`
in that directory and fill the development-instance settings locally. `.dev.vars`
is ignored by Git. `CLERK_TEST_SUBJECT` and `AUTH_POC_ACCOUNT_ID` provision one private
mapping; preserve the internal account ID between runs. This is neither account
registration nor a provider-migration implementation. Keys and client IDs must belong
to the configured issuer; the live check of that association is still outstanding.

```sh
npx wrangler dev --config infrastructure/auth-poc/wrangler.jsonc --local --log-level error
```

Only `GET /api/auth/v1/poc/check` is registered. The desktop will send its opaque
credential in the Authorization header. Do not paste credentials into URLs, shell
commands or task messages. Success is `{ "status": "verified" }`; missing/invalid
credentials get 401, URL parameters get 400, incomplete configuration gets a sanitized 503. No account IDs, provider identifiers or email addresses are returned. Stop the
local server after testing. No dashboard action is needed for the stubbed tests.

## Evidence ledger

| Required gate                                           | Status       | Evidence / remaining work                                                                                                                                                |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Email code in system browser, no Microsoft account   | Blocked      | Isolated browser entry built; Windows harness pending; no live test instance configured.                                                                                 |
| 2. Existing Academy browser session avoids another code | Blocked      | Must exercise custom consent page on the same web origin and same browser profile.                                                                                       |
| 3. One-time verifier-bound desktop return               | Blocked      | Public client + required S256 PKCE documented; live wrong-verifier, replay, state and loopback tests pending.                                                            |
| 4. Worker token and verified-email validation           | Blocked      | Actual local workerd passes with stubbed Clerk responses; live Clerk token/email verification remains pending.                                                           |
| 5. Expiry, refresh, revoke, independent logout          | Blocked      | Local expiry/revocation checks covered; provider lifecycle and session independence untested.                                                                            |
| 6. Stable account ID and provider migration             | Blocked      | Email-independent directory boundary tested. Durable mapping and proof of both identities for migration pending.                                                         |
| 7. Anonymous public search                              | Pass (local) | Product `GET /api/bench/v1/runs` without Authorization returns 200; PoC route returns 404 in product app. Existing benchmark suite supplies broader regression coverage. |

No mandatory Clerk gate has yet failed; there is no evidence-based reason to switch
to Cognito at this checkpoint. If a live gate fails or needs a complex workaround,
evaluate Cognito Essentials next, then Stytch.

## Current official evidence

- [Clerk OAuth](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth):
  public clients, required S256 PKCE, opaque access tokens; access token lifetime one
  day, refresh tokens do not expire, authorization codes ten minutes.
- [Verification](https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens)
  and [versioned Backend API schema](https://github.com/clerk/openapi-specs/blob/main/bapi/2026-05-12.yml):
  server verification endpoint and response fields. The OpenAPI server base includes
  `/v1`; use it rather than the unversioned URL shown in the verification guide.
- [Official CLI reference](https://github.com/clerk/cli-auth-example): demonstrates
  loopback PKCE, but explicitly does not revoke on logout. Do not adopt its logout
  behavior or plaintext credential-file fallback. Windows PoC should use DPAPI or
  Credential Manager, outside either product's state directory.
- [Custom consent page](https://clerk.com/docs/react/guides/configure/auth-strategies/oauth/custom-consent-page):
  candidate for reusing the Academy web session. This still requires a live test.
- [Clerk pricing](https://clerk.com/pricing): checked 2026-09-22. Hobby identity
  charges are $0/month at 1k, 10k and 50k **MRU**. MRU counts a user returning at least
  24 hours after signup; it is not MAU. Pro is $25/month monthly or $20/month with annual
  billing, including 50k MRU. Email codes are included; Hobby browser sessions are
  fixed to seven days. Development instances expose Pro features, so a successful
  dev trial alone cannot prove Hobby entitlement for the final OAuth configuration.
  Confirm dashboard feature labels before calling this the total production price.
- [Cognito pricing](https://aws.amazon.com/cognito/pricing/): checked 2026-09-22.
  Essentials direct sign-in: 10k MAU free, then $0.015/MAU; at 1k/10k/50k MAU this is
  $0/$0/$600 monthly plus SES delivery. No AWS implementation evaluated yet.

These are identity list prices excluding taxes, Worker/database use and operational
costs. Stytch's old $0.20 figure has not yet been reverified and is not accepted as
current evidence. Final cost and provider recommendation follow the live gates.

## Isolated browser harness

The separate Vite root is `apps/web/auth-poc`; its configuration lives in
`infrastructure/auth-poc/web.config.ts`. Normal Academy entry points do not import it.
`@clerk/react` is a direct web dependency, used only by the browser auth adapter.
The API adapter still uses REST. No provider types enter product code.

Run from `apps/web`:

```sh
npx panda codegen
npx vite --config ../../infrastructure/auth-poc/web.config.ts
```

Open `http://127.0.0.1:5190/`. Without a configured development publishable key, the
page displays a setup message and does not initialize Clerk. When the full local
harness is ready, copy `infrastructure/auth-poc/.env.example` to `.env.local` in that
same directory and set the development publishable key locally. Never place the
Worker secret key in a `VITE_*` variable. Restart Vite after changing the environment.

Routes: `/` shows browser session status, `/sign-in` and `/sign-up` host Clerk widgets,
and `/oauth/consent` hosts the unmodified prebuilt consent component. The consent
route has no home/logout controls and preserves the original authorization parameters.
The HTML sets the referrer policy required by Clerk's cross-origin consent form.
Browser logout targets the current browser session only. Its actual interaction with
desktop OAuth grants still needs a live check; SDK call arguments do not prove that.
Email-code-only authentication must be configured in the test dashboard; a sign-in
widget alone does not enforce that setting.

Twelve additional browser tests use stubbed Clerk components. They cover setup guards,
loading, provider subroutes, protected consent, preservation of consent parameters,
current-session logout and sanitized logout errors. They do not test real Clerk UI,
email delivery, consent submission, SSO or token issuance. The standalone build and
local HTTP entry/module smoke check pass; the normal web build contains no Clerk JS.

## Next reviewable step

Add a standalone .NET Windows harness and connect it to this local Worker and browser
entry. Use the system browser, state, S256 PKCE, a one-shot
loopback listener, secure credential storage, explicit refresh and remote revoke.
Do not integrate the Benchmark product or touch its run state. Exercise the Worker
locally and prepare exact development-dashboard steps only once these tools are ready.

For migration, rehearse linking an authenticated old account to a separately verified
new identity using a short-lived, one-time, session-bound transaction. Same email
must never create the link. Reject conflicts; preserve internal account IDs. No live
migration endpoint or database change exists in this step.
