# Clerk evaluation checkpoint — 2026-09-22

Recommendation: plan integration with Clerk, pending natural expiry and confirmation
that the required OAuth settings are available on Hobby in production. Lock denied
the stored desktop credential in a live test and is sufficient for the initial
account-blocking requirement; provider-side Ban is not required. No mandatory
scenario has demonstrated a provider failure requiring a Cognito fallback. This is
not approval for product deployment. Cognito and Stytch have not been evaluated live.

## Evidence

| Gate                                        | Status                                    | Evidence and limits                                                                                                                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email-code sign-in, no Microsoft account    | Pass, live/user-observed                  | User confirmed code-only browser sign-in after disabling passwords. Native system-browser launch was tested separately.                                                                                                                                       |
| Existing Academy session, no new code       | Pass, live                                | User confirmed no new email challenge on desktop re-login; consent and Worker verification succeeded.                                                                                                                                                         |
| One-time code + PKCE return                 | Pass, live + local                        | Wrong verifier and reused code received invalid_grant. Callback carries code, not tokens. Local tests cover state and callback rejection.                                                                                                                     |
| Worker token, user and primary-email checks | Blocked for remaining live negative cases | Live positive verification and Lock/Unlock denial/recovery passed. Malformed/unverified primary email is rejected locally. A live unverified-primary state could not be created: documented update returned HTTP 400. Ban is outside the initial requirement. |
| Expiry, refresh, revoke, independent logout | Blocked on natural expiry                 | Refresh, revoke and browser/desktop logout independence passed live. Stored access credential expires 2026-09-23 17:55:01 UTC (20:55:01 Europe/Riga). Do not refresh before the expiry test.                                                                  |
| Stable internal account ID, migration       | Pass, local model only                    | 19 synthetic dual-identity tests cover stable ID, no email linking, session binding, conflicts, expiry, replay and concurrent completion. No durable database or real second-provider migration tested.                                                       |
| Anonymous public search                     | Pass, local                               | Product search succeeds without Authorization; the isolated PoC route is absent from the product Worker.                                                                                                                                                      |

Detailed evidence: [live sequence](live-check.md),
[adapter and migration tests](../../apps/api/src/auth-poc/README.md),
[Windows harness](../../tools/auth-poc-desktop/README.md).
Latest local API PoC run: 109 tests passed; API typecheck, ESLint and Prettier passed.
Earlier Windows and browser runs passed 33 and 13 tests respectively.

## Identity pricing

USD/month, checked against [Clerk pricing](https://clerk.com/pricing) on 2026-09-22.
Counts below are **MRU per application**, not registered users or MAU: a retained
user returns in a month at least 24 hours after signup.

| Plan                                    | 1k MRU | 10k MRU | 50k MRU |
| --------------------------------------- | -----: | ------: | ------: |
| Hobby                                   |     $0 |      $0 |      $0 |
| Pro, monthly billing                    |    $25 |     $25 |     $25 |
| Pro, annual billing, monthly equivalent |    $20 |     $20 |     $20 |

Annual Pro costs $240/year. Email codes are included. Hobby fixes browser sessions
to seven days and excludes user bans; that session limit is not the OAuth access
token lifetime. The initial budget assumes Hobby and uses Lock for account blocking.
This is identity plan pricing, not a complete application operating budget: taxes,
Worker/database use, optional add-ons and operational effort are excluded. The
development trial does not establish production entitlement for every OAuth setting;
verify feature labels before committing to Hobby. API-key/M2M metering must not be
assumed to apply to this user-delegated OAuth flow without provider confirmation.

## Remaining risks and next check

- After **23 September, 20:56 Europe/Riga**, run `status`, then `check` (must deny),
  `refresh`, then `check` (must verify). Leave the stored credential unchanged until
  then; restarting the harness is safe. No automatic follow-up has been scheduled.
- [OAuth documentation](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)
  states one-day access tokens and non-expiring refresh tokens. The versioned
  Frontend API schema says ten years for refresh tokens. Lifetime and rotation/reuse
  behavior remain unresolved; successful refresh does not establish replay detection.
- Each accepted Worker check makes two Backend API calls. Published
  [rate limits](https://clerk.com/docs/guides/how-clerk-works/system-limits) are 100
  requests/10 seconds in development and 1,000/10 seconds in production, shared per
  instance. Inference: absent other traffic, this bounds the current two-call design
  to at most 500 accepted checks/10 seconds in production, not a measured throughput
  guarantee. Latency, availability and burst behavior have not been load-tested.
- Public-client revocation worked only after adding `client_id` to the form; the
  documented schema omits it. Keep this live compatibility result in regression notes.
- Real migration needs independent provider verification, durable unique mappings,
  transactional ticket consumption and a confirmation flow. The memory model proves
  policy only. Existing provider sessions do not transfer to the new provider.

No new dashboard action or paid upgrade is needed for the pending expiry test.
