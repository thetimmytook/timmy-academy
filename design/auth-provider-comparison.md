# Managed auth comparison — discussion draft

Status: research snapshot, 2026-09-18. Scope: Timmy Academy identity shared with Benchmark publication. No provider selected.

The provider-isolation and Windows browser sign-in direction is recorded in `auth-boundary.md`. No Microsoft account is required by that flow.

## Boundary

If managed auth is chosen, use one identity provider rather than building email challenge delivery and account sessions in the benchmark Worker. The Worker remains authoritative for benchmark ownership, consent, quota, moderation and publication state. Anonymous public search requires no identity. Academy may assign an anonymous application ID for durable progress and, after verified sign-in, merge its progress into the authenticated application account. That merge remains our product logic regardless of provider; a provider's user-linking feature does not merge arbitrary application records.

The current copied architecture file proposes self-managed auth. Choosing a managed provider would supersede only that auth section. It does not require a separate self-hosted auth microservice. `/api/auth/v1` can be reserved for an application-specific desktop handoff or account endpoint if needed; sign-in routes may belong to the provider.

## Fit by requirement

| Requirement          | Clerk                                                                                                                                                                         | Stytch Consumer                                                                                                    | Cognito Essentials                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Email OTP            | Included on Hobby; magic links also included.                                                                                                                                 | Email OTP and magic links supported.                                                                               | Passwordless email OTP supported on Essentials; email delivery uses SES configuration.                                |
| Worker validation    | Session JWT and OAuth JWT can be verified with public keys; opaque OAuth access tokens can be remotely verified.                                                              | Five-minute session JWT can be verified locally; opaque session token remotely.                                    | User-pool JWTs can be verified locally with JWKS.                                                                     |
| Logout/revoke        | Session revocation supported. Default OAuth JWT access tokens last one day and cannot be revoked before expiry; choose opaque OAuth tokens if immediate revocation is needed. | Opaque session token reflects revocation immediately; locally checked JWT can remain valid up to five minutes.     | Refresh token/global sign-out supported, but a revoked JWT still passes ordinary local signature/expiry verification. |
| Windows Benchmark    | Public OAuth client with authorization code + PKCE appears feasible; verify WPF redirect and token refresh in a small proof of concept.                                       | A custom native/web handoff appears possible; confirm Consumer flow and Windows return path in a proof of concept. | Public app client with authorization code + PKCE is documented.                                                       |
| Anonymous to account | Our backend merges Academy progress after sign-in.                                                                                                                            | Same.                                                                                                              | Identity Pools support unauthenticated identities, but our Academy progress merge remains our responsibility.         |

## Monthly identity cost estimate

Assumptions: one consumer application; email OTP; no SMS, custom branding, enterprise features, fraud add-ons, or negotiated discounts. These are identity charges, not Worker, database or email-delivery charges. Units differ: Clerk bills _monthly retained users_ (MRU, users returning at least a day after signup); Stytch and Cognito bill _monthly active users_ (MAU). Compare only after modelling real retention.

| Volume |   Clerk Hobby | Stytch Consumer pay-as-you-go |     Cognito Essentials |
| ------ | ------------: | ----------------------------: | ---------------------: |
| 1,000  |            $0 |                            $0 |               $0 + SES |
| 10,000 |            $0 |                            $0 |               $0 + SES |
| 50,000 | $0 at 50k MRU |            ~$8,000 at 50k MAU | ~$600 at 50k MAU + SES |

Clerk Hobby includes 50k MRU; Pro is $25/month paid monthly or $20/month billed annually for features such as custom session duration and branding removal. Stytch Consumer includes 10k MAU and lists $0.20 for each additional MAU in the current pricing page's embedded calculator data; $8,000 is a straight list-rate extrapolation of 40k extra MAU, and an enterprise quote could differ. Cognito Essentials lists 10k MAU free and $0.015 per additional direct-sign-in MAU, giving $600 for 40k extra; SES sending is separate.

## Provisional conclusion

Clerk is the strongest first candidate for this project's current size and React website, provided the Windows Benchmark PKCE flow and desired revocation behavior pass a proof of concept. For infrequent desktop publication writes, remotely verified opaque OAuth tokens are a plausible way to get immediate revocation. Stytch offers a clean session model and immediate revocation with opaque tokens, but published Consumer list pricing is difficult to justify for a free community product beyond 10k MAU. Cognito Essentials is a reasonable cost fallback and has a documented public-client PKCE flow; it brings AWS/SES configuration and a local-JWT revocation caveat.

Keep provider identity IDs private; use them only to associate accounts with benchmark ownership. Do not put email or provider IDs into public run records. Do not select a provider solely from the 50k headline: desktop flow, token revocation and the product's real MRU/MAU ratio matter.

## Primary sources

- Clerk pricing: https://clerk.com/pricing
- Clerk public OAuth clients and PKCE: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth
- Clerk OAuth token verification and formats: https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens and https://clerk.com/docs/guides/development/machine-auth/token-formats
- Stytch pricing: https://stytch.com/pricing
- Stytch session JWT/token behavior: https://stytch.com/docs/consumer-auth/manage-sessions/jwts-and-tokens
- Cognito pricing and OTP: https://aws.amazon.com/cognito/pricing/
- Cognito PKCE and revocation: https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html and https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html
