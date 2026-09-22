# Auth provider proof: step 1

Review checkpoint, 2026-09-22. Clerk remains a candidate, not a selected provider.
This directory is not imported by the product Worker, web app or Windows apps.
It has no deployment configuration, account provisioning or run publication.
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
npx vitest run apps/api/src/auth-poc/auth-poc.api.test.ts
npm run typecheck -w @timmy/api
npx eslint apps/api/src/auth-poc
npx prettier --check apps/api/src/auth-poc
```

Tests use synthetic responses and identities. They establish our denial rules and
response boundary, not Clerk service behavior or Cloudflare runtime compatibility.

Local verification on 2026-09-22: **78/78 PoC tests passed**, including malformed
provider responses, missing/null primary-email IDs and overflow when converting expiry
to milliseconds. API TypeScript, targeted ESLint and Prettier checks passed.
The earlier full API baseline passed 132 tests before these additional PoC cases.

## Evidence ledger

| Required gate                                           | Status       | Evidence / remaining work                                                                                                                                                |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Email code in system browser, no Microsoft account   | Blocked      | Clerk documents email codes; browser and Windows harness not yet built; no test instance configured.                                                                     |
| 2. Existing Academy browser session avoids another code | Blocked      | Must exercise custom consent page on the same web origin and same browser profile.                                                                                       |
| 3. One-time verifier-bound desktop return               | Blocked      | Public client + required S256 PKCE documented; live wrong-verifier, replay, state and loopback tests pending.                                                            |
| 4. Worker token and verified-email validation           | Blocked      | Adapter denial/privacy tests use mock HTTP. Actual Worker runtime and live Clerk verification pending.                                                                   |
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

## Next reviewable step

Add a separately started local Worker, minimal English React auth/consent UI and a
standalone .NET Windows harness. Use the system browser, state, S256 PKCE, a one-shot
loopback listener, secure credential storage, explicit refresh and remote revoke.
Do not integrate the Benchmark product or touch its run state. Exercise the Worker
locally and prepare exact development-dashboard steps only once these tools are ready.

For migration, rehearse linking an authenticated old account to a separately verified
new identity using a short-lived, one-time, session-bound transaction. Same email
must never create the link. Reject conflicts; preserve internal account IDs. No live
migration endpoint or database change exists in this step.
