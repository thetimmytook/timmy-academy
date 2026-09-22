# Auth provider proof: adapter, local Worker and browser harness

Review checkpoint, 2026-09-22. Clerk remains a candidate, not a selected provider.
Live progress: Worker verification, refresh, desktop survival after browser logout,
and public-client revoke with negative access/refresh checks have succeeded. The
[live evidence log](../../../../infrastructure/auth-poc/live-check.md) records details;
the full gates below remain open where their other scenarios are still pending.
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
a same-instance live check has succeeded, but mismatched key/client/issuer combinations have not been exercised live.

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

Local verification on 2026-09-22: **109/109 PoC tests passed**, including malformed
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
to the configured issuer; the same-instance live check has passed; live mismatched-instance tests remain outstanding.

```sh
npx wrangler dev --config infrastructure/auth-poc/wrangler.jsonc --local --log-level error
```

Only `GET /api/auth/v1/poc/check` is registered. The desktop will send its opaque
credential in the Authorization header. Do not paste credentials into URLs, shell
commands or task messages. Success is `{ "status": "verified" }`; missing/invalid
credentials get 401, URL parameters get 400, incomplete configuration gets a sanitized 503. No account IDs, provider identifiers or email addresses are returned. Stop the
local server after testing. No dashboard action is needed for the stubbed tests.

## Evidence ledger

| Required gate                                           | Status                     | Evidence / remaining work                                                                                                                                                                             |
| ------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Email code in system browser, no Microsoft account   | Pass (live, user-observed) | After disabling passwords, user confirmed successful browser sign-in with only an email code. System-browser desktop flow was separately verified.                                                    |
| 2. Existing Academy browser session avoids another code | Pass (live)                | User confirmed no new email code during desktop re-login; consent completed, credential stored and real Worker returned verified.                                                                     |
| 3. One-time verifier-bound desktop return               | Pass (live + local)        | Real wrong-verifier and reused-code exchanges returned invalid_grant; original credential passed Worker verification. State/loopback rejection covered locally; code-only callback by construction.   |
| 4. Worker token and verified-email validation           | Blocked                    | Live verification and Lock/Unlock denial/recovery passed with the same credential; unverified-primary state could not be created (API HTTP 400). Lock meets the initial account-blocking requirement. |
| 5. Expiry, refresh, revoke, independent logout          | Blocked                    | Live refresh, revoke and independent logout in both directions passed; natural expiry remains pending.                                                                                                |
| 6. Stable account ID and provider migration             | Blocked                    | 19 local migration tests pass with synthetic proofs from two issuers. Persistent storage and real authentication with a second provider remain untested.                                              |
| 7. Anonymous public search                              | Pass (local)               | Product `GET /api/bench/v1/runs` without Authorization returns 200; PoC route returns 404 in product app. Existing benchmark suite supplies broader regression coverage.                              |

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
  reusing the Academy web session passed the live desktop re-login test.
- [Clerk pricing](https://clerk.com/pricing): checked 2026-09-22. Hobby identity
  charges are $0/month at 1k, 10k and 50k **MRU**. MRU counts a user returning at least
  24 hours after signup; it is not MAU. Pro is $25/month monthly or $20/month with annual
  billing, including 50k MRU. Email codes are included; Hobby browser sessions are
  fixed to seven days. Development instances expose Pro features, so a successful
  dev trial alone cannot prove Hobby entitlement for the final OAuth configuration.
  Lock meets the initial account-blocking requirement; Ban is not required. Confirm
  dashboard feature labels before calling Hobby the production plan.
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

Thirteen additional browser tests use stubbed Clerk components. They cover setup guards,
loading, provider subroutes, protected consent, preservation of consent parameters,
current-session logout and sanitized logout errors. They do not test real Clerk UI,
email delivery, consent submission, SSO or token issuance. The standalone build and
local HTTP entry/module smoke check pass; the normal web build contains no Clerk JS.

## Standalone Windows harness

`tools/auth-poc-desktop` contains a .NET 8 Windows console harness, separate from both
Benchmark products. It opens the system browser, uses independent state and S256 PKCE,
receives one valid loopback callback on a random port, and stores credentials using
Windows DPAPI. Its auth adapter makes explicit refresh/revoke requests and sends
the opaque access credential only in the local Worker's Authorization header.

33 Windows tests pass, including real loopback sockets and DPAPI plus stubbed provider
responses. Browser launch, email delivery and real provider behavior are not covered
by those tests. Commands include wrong-verifier and code-replay live probes, remote
revocation while retaining credentials for negative checks, and logout after remote
acknowledgement. No credential is logged or stored in plaintext. See the
[harness README](../../../../tools/auth-poc-desktop/README.md) for commands and limits.

## Next reviewable step

Continue the live gates using the configured development application and the
[dashboard setup and evidence sequence](../../../../infrastructure/auth-poc/live-check.md).
Public-client revoke now passes with a public `client_id` form field, which the
Frontend API schema omits. Do not interpret a timeout as confirmed rejection.
The OAuth guide and Frontend API schema
also disagree on refresh-token lifetime (unlimited versus ten years); this remains
an explicit provider question. No provider is selected yet.

For migration, the local model rehearses linking an authenticated old account to a separately verified
new identity using a short-lived, one-time, session-bound transaction. Same email
must never create the link. Reject conflicts; preserve internal account IDs. No live
migration endpoint or database change exists in this step.

## Local provider-migration rehearsal

`migration-rehearsal.ts` is imported only by its tests. It implements the existing
private `AccountDirectory` boundary in memory; neither the live Worker nor a product
entry point uses it. The two authentication verifiers are synthetic test doubles,
not a second provider integration or proof of a live migration.

The model links a verified target identity to the source account ID after checking
both credentials again. A random, one-use ticket is bound to the initiating source
identity and session, a configured target issuer, and a maximum five-minute lifetime
(shorter if the original source credential expires first). Email is not a lookup key.
The old mapping remains available during this simulated overlap; retiring it and
revoking old-provider sessions are separate migration rollout decisions.

Nineteen tests cover preservation of account IDs used by private ownership/progress
references, matching emails and subjects across issuers without implicit linking,
unknown source identities, rejected/revoked credentials, wrong sessions and issuers,
invalid/expired proofs, conflicting ownership, ticket expiry, replay, and concurrent
completion. Errors are sanitized. These are local policy tests, not actual run or
Academy progress migration tests.

The final map insertion and ticket consumption have no intervening await, which is
atomic only within this single-process model. Production would need a durable unique
constraint on `(issuer, subject)` and an atomic database transaction for consumption
and insertion, plus actual authentication adapters, browser request protections and
an explicit confirmation flow. This rehearsal supplies none of those endpoints and
does not change the current Clerk account or desktop credential.

Current cost estimate, expiry timestamp and recommendation: [provider checkpoint](../../../../infrastructure/auth-poc/provider-checkpoint.md).
