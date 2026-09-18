# Shared auth boundary — agreed direction

Status: product/architecture decision, 2026-09-18. Provider remains undecided.

## User flow

- A Timmy Academy account uses email verification; a Microsoft account is not required.
- The preferred Windows Benchmark sign-in opens the system browser. If the user already has an Academy web session, the browser presents a short approval/return step without another email code. Otherwise the user enters an email and one-time code on the website.
- Return to the desktop application through an authorization-code flow with PKCE (or an equivalent one-time verifier-bound exchange). Do not put an access token in a redirect URL. The application stores its resulting credential in suitable Windows secure storage.
- Browser and desktop sessions are separate and revocable. Logging out of one device does not silently publish, delete or alter benchmark runs.
- Public benchmark search remains anonymous. Authentication is needed only for publication and owner operations.

## Replaceable provider boundary

- The auth provider owns email challenge delivery, identity proof and its session/token lifecycle. The application owns benchmark publication, ownership, limits, profiles and Academy progress.
- Application APIs use a stable internal application account identity. Provider-specific `issuer` and `subject` are private identity mappings; they are never public run IDs and never appear in anonymous API responses.
- Put provider SDK and token verification behind one auth adapter in the Worker. Product routes receive an application principal (`accountId`, verification state, session context), not a Clerk/Stytch/Cognito user object.
- Keep provider-specific browser widgets and desktop authorization mechanics at the auth entry points. Benchmark and Academy product code must not import a provider SDK or branch on provider names.
- Do not put provider token claims into durable benchmark records. Public nickname is separately editable and is not an identity key.
- A provider switch must preserve the application's account IDs, run ownership and Academy progress. Plan an explicit account-link/migration process that verifies the new identity and safely maps it to the existing account; matching an email string alone is not sufficient proof of ownership.
- Existing provider sessions cannot be carried over automatically. A provider change may require a one-time sign-in, but must not require users to republish runs or lose progress.

## Route implications

- Keep `/api/bench/v1` and `/api/academy/v1` independent of the auth provider.
- Reserve `/api/auth/v1` for any application-owned account, session bridge or desktop authorization endpoints that prove necessary. Provider-hosted sign-in may use its own routes/domains; do not promise a provider-independent endpoint for every auth operation.
- The browser page that approves desktop login should live on `timmy.academy` so it can reuse the Academy browser session. Its exact URL and callback mechanism are implementation details to settle with the selected provider.

## Proof before provider selection

Mandatory gates for each candidate: fresh email-code sign-in from the Windows app through the browser; already-signed-in Academy browser flow without another code; no Microsoft account requirement; safe one-time desktop return; Worker verification of email ownership on publish; logout/revoke and expiry/refresh; stable application account identity with a safe migration rehearsal. A candidate that needs a complex workaround for a gate is rejected.

For candidates that pass, compare total cost at 1k/10k/50k active users using the provider's actual billing unit, implementation effort across React/Worker/WPF, operational burden and free-plan restrictions. Clerk is the first proof-of-concept candidate, Cognito Essentials the second. Reconsider Stytch if either fails a gate or Stytch offers a material advantage. No provider is selected yet. The provider comparison is in `auth-provider-comparison.md`.
