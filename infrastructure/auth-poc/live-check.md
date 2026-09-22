# Clerk development-instance live check

Prepared 2026-09-22. Live checks are in progress; see the evidence below. Local mocked
tests are not provider acceptance evidence. This runbook uses only the isolated PoC; do not deploy
it, attach a production domain or change either Benchmark product.

## Dashboard setup (user action)

1. Create a Clerk account and a new application named `Timmy Academy Auth PoC`.
   Select its **Development** instance throughout these steps.
2. Under **User & authentication**, enable email sign-up/sign-in and **Email
   verification code**, with email verification required. Disable password, email
   links, phone, passkeys and social/enterprise connections for this new test app.
   Use a mailbox you control; do not use a bypass/test email address for the delivery
   test. Microsoft sign-in must not be required. [Authentication options](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options).
3. Set the development application/home URL to `http://127.0.0.1:5190`. In **Paths →
   Component paths**, select custom sign-in `/sign-in`, sign-up `/sign-up` and OAuth
   consent `/oauth/consent`. Development consent settings take a path on the development
   host. If the dashboard asks for the host separately, use the URL above. Keep the
   same host spelling and browser profile throughout. [Custom consent settings](https://clerk.com/docs/react/guides/configure/auth-strategies/oauth/custom-consent-page).
4. In **OAuth applications**, create `Academy Windows PoC`: enable **Public** and
   **Require PKCE**, keep the consent screen enabled, and allow only `email
offline_access`. Register redirect URI **`http://127.0.0.1/callback`**, without a
   fixed port. Leave dynamic registration/device grant disabled. The CLI documentation
   describes dynamic loopback ports for this registration. [Loopback setup](https://clerk.com/blog/adding-clerk-auth-to-your-cli).
5. Under the OAuth applications **Settings → Access token format**, select **Opaque
   access tokens**. Recheck Public, required S256 PKCE and consent on the client.
   Record any production-plan/paywall labels without upgrading the plan. [OAuth settings](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth).
6. Fill these files locally; **do not paste keys, IDs, email addresses or tokens into
   task messages**:

   | Copy example to (same directory)              | Values                                                                                                                                                                                           |
   | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `.env.example` → `.env.local`                 | Development publishable key (`pk_test_...`) only.                                                                                                                                                |
   | `.dev.vars.example` → `.dev.vars`             | Development issuer origin, OAuth Client ID, development secret (`sk_test_...`). Fill the test subject after first sign-up. Generate one private internal account ID and preserve it across runs. |
   | `desktop.example.json` → `desktop.local.json` | The same development issuer and OAuth Client ID; no secret.                                                                                                                                      |

   All three destination files are ignored by Git. Get the issuer from this instance's
   Frontend API URL (`https://<instance>.clerk.accounts.dev`, no trailing slash), and
   get the **Client ID**, not OAuth application's object ID, from the OAuth client.
   Verify that both keys, issuer and client belong to this same development instance.

If any named option is unavailable, report only its label and the blocking message,
with private values removed. Do not compensate by embedding a client secret or
disabling PKCE/consent. Once configured, tell the agent **“Clerk dev configured”**.

## Local launch

In a terminal at `apps/web`:

```powershell
npx panda codegen
npx vite --config ../../infrastructure/auth-poc/web.config.ts
```

In a second terminal at the repository root:

```powershell
dotnet run --project tools/auth-poc-desktop/AuthPoc.Desktop.csproj -- infrastructure/auth-poc/desktop.local.json
```

After the first email-code sign-up, find that user in the test dashboard and put its
ID into `CLERK_TEST_SUBJECT` in `.dev.vars`. The mapping is provisioned from the user
object's identity, not discovered by matching an email string. Then start the local
Worker in a third terminal at the repository root:

```powershell
npx wrangler dev --config infrastructure/auth-poc/wrangler.jsonc --local --log-level error
```

## Evidence sequence

Record only each step's Pass/Fail/Blocked, UTC time and sanitized status. No HAR files,
request URLs with authorization codes, raw JSON bodies, keys or identity screenshots.

1. **Fresh flow:** use `login` with this test application's browser session signed out.
   Complete real email OTP and consent in the system browser. Confirm no Microsoft
   account/password is requested. After mapping the user and starting Worker, `check`
   must say `Worker: verified`. Visit `http://127.0.0.1:5190/` in the same profile and
   confirm the browser is signed in.
2. **Desktop logout independence:** `logout`, then reload the browser page. It must
   remain signed in. Run `login` again: approval/return may appear, but no new email
   code should be requested. Run `check` again.
3. **Browser logout independence:** use the page's browser sign-out button. Desktop
   `check`, `refresh`, then `check` must still succeed. Sign in on the browser page
   again to prepare later tests.
4. **Remote revoke:** `revoke`, then `check` must deny and `refresh` must report
   `invalid_grant`. A generic timeout/failure is Blocked, not Pass. Browser session
   must survive. Only then use `forget` / `FORGET` to remove the retained test credential.
5. **PKCE:** `probe-pkce` must explicitly report wrong-verifier rejection. Then
   `probe-replay` starts a fresh flow and must explicitly report used-code rejection;
   run `check` on the stored valid credential. Rejection of the callback locally is
   tested separately and does not prove provider code replay protection.
6. **Email/user policy:** on the disposable test user, test banned/locked and
   unverified-primary-email states where dashboard controls permit, followed by
   `check`; restore the state and confirm recovery. A verified secondary email must
   not rescue an unverified primary. If a state cannot be created through supported
   controls, record Blocked rather than substituting mocked evidence.
7. **Natural expiry:** keep a valid credential without refreshing through its actual
   expiry (currently documented as one day), then `status`, `check` (denied), `refresh`,
   `check` (verified). Restarting the harness may preserve it. Do not change the system
   clock or encrypted file and call that proof of provider expiry.
8. Finish with `logout` and stop local servers. Provider migration with dual identity
   proof remains a separate unimplemented rehearsal; this harness does not prove gate 6.

## Live evidence so far (2026-09-22)

- Passwordless gate correction: the user reported a password prompt in ordinary browser sign-in. Read-only configuration inspection confirmed password enabled/required, email-code enabled, and an existing password on the test user. After disabling password settings and fixing PoC navigation, the user explicitly confirmed successful sign-in requesting only an email code. Passwordless browser entry is now Pass (user-observed live test). Previous SSO, PKCE, token and logout results do not prove passwordless entry.

- User completed the browser flow; desktop received and securely stored a credential.
  The real local Worker returned `verified`, including its primary-email and private
  identity-mapping checks. Explicit refresh followed by another check also succeeded.
- After user-confirmed browser logout, desktop check, refresh and check all succeeded.
- Initial revoke without `client_id` returned HTTP 400 `invalid_request`. Adding the
  public `client_id` to the form (no secret) made both revoke requests succeed.
  Subsequent Worker check returned `denied`, and refresh returned `invalid_grant`.
  Repeating revocation via `logout` succeeded and removed the local credential.
- User confirmed the browser still displayed `signed in` after desktop logout. A subsequent desktop login
  completed consent and Worker verification; the user explicitly confirmed no new email
  code was requested. The live wrong-verifier probe then returned `invalid_grant`;
  no credential was stored. The live code-replay probe also returned `invalid_grant`
  on the second exchange; the credential from the first exchange remained accepted
  by the Worker. Natural expiry remains outstanding; dual-proof migration now has a separate local rehearsal, not a live second-provider test.

- Lock test: after user-applied Lock, the real Backend API reported `locked=true` and `banned=false`; the stored desktop credential received Worker `denied`. After user-applied Unlock, the Backend API reported `locked=false` and the same stored credential returned Worker `verified`, without login or refresh. Lock rejection and recovery are Pass (live).
- Ban test: user reports the dashboard requires Pro. The project chose Lock for the initial account-blocking requirement after the live Lock/Unlock test; provider-side Ban is not required for this release. Revisit Pro only if a needed feature requires it.

- Unverified-primary test: baseline Worker returned HTTP 200. The documented PATCH with `verified=false` was rejected by the live email endpoint with HTTP 400, so the target state was not reached and the negative live test is Blocked. A finally-path restored/confirmed the original primary as verified; the same credential again received HTTP 200. No email address, identity, token or provider response body was logged. Local malformed/unverified-primary tests remain valid but do not replace this live case.

## Provider details and remaining questions

- [Current Frontend API schema](https://github.com/clerk/openapi-specs/blob/main/fapi/2026-05-12.yml)
  describes `/oauth/token/revoke` with `token` and `token_type_hint`, and mentions
  confidential-client authentication, but omits the public `client_id` form field
  required by the live endpoint in this test. Public-client revocation is now confirmed
  for this development instance with `client_id`, `token` and `token_type_hint`.
  The harness sends no secret and revokes both refresh and access credentials explicitly.
- The OAuth guide says refresh tokens never expire, while the schema describes ten
  years. Treat refresh lifetime/rotation as unresolved until clarified; neither claim
  replaces the immediate revocation test.
- A successful development trial does not prove production feature entitlement,
  complete issuer/key association validation, production domain behavior, rate limits,
  or migration safety. Keep these open in the final provider decision.

## Expiry checkpoint (2026-09-22)

Read-only inspection of the DPAPI credential found expiry at 2026-09-23 17:55:01 UTC
(20:55:01 Europe/Riga). Only expiry metadata was emitted; no token was printed or
changed. A subsequent live Worker check returned verified. Perform the natural
expiry sequence after 20:56 Riga time on 23 September, without refreshing beforehand.
See the [provider checkpoint](provider-checkpoint.md) for the current gate table,
pricing and remaining risks. No follow-up is scheduled automatically.
