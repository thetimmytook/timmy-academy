# Isolated Windows auth harness

Local .NET 8 console UI for Clerk candidate evaluation. Requires Windows, the .NET 8
SDK and ASP.NET Core runtime (included with the SDK). This is not a Benchmark app,
WPF integration, installer or deployable product. It never reads runs or game state.

From the repository root:

```powershell
dotnet test tools/auth-poc-desktop/Tests/AuthPoc.Desktop.Tests.csproj
dotnet run --project tools/auth-poc-desktop/AuthPoc.Desktop.csproj -- infrastructure/auth-poc/desktop.local.json
```

Create the ignored `desktop.local.json` from the adjacent example in
`infrastructure/auth-poc`. It contains only the development issuer and public client
ID. No provider secret belongs in the desktop configuration. The Worker check URL
is fixed to `http://127.0.0.1:8790/api/auth/v1/poc/check` for this local experiment.

| Command        | Behavior                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login`        | Opens the system browser, waits up to three minutes, exchanges code with S256 PKCE, stores credential. Refuses to replace an existing grant.      |
| `probe-pkce`   | Starts a fresh flow but submits the wrong verifier. Expects explicit `invalid_grant`; attempts revocation if a credential is unexpectedly issued. |
| `probe-replay` | Starts a fresh flow, stores credential, then reuses the code. Expects explicit `invalid_grant`; attempts cleanup if replay succeeds.              |
| `status`       | Reports absence/local expiry without printing tokens or identities.                                                                               |
| `check`        | Sends the opaque access token in the Worker Authorization header, including when locally expired. Does not auto-refresh.                          |
| `refresh`      | Explicit refresh; stores the returned refresh token when rotated, retains it when omitted. Does not retry automatically.                          |
| `revoke`       | Requests remote revocation of refresh and access tokens. Retains local data specifically for negative `check`/`refresh` tests.                    |
| `logout`       | Requests both revocations, then removes local credential only after acknowledgement.                                                              |
| `forget`       | Removes local credential after typing `FORGET`; does not claim remote revocation.                                                                 |
| `quit`         | Exits while preserving credential.                                                                                                                |

The browser receives only a code and state. A one-shot Kestrel listener binds IPv4
loopback on an OS-assigned port; it rejects wrong host/path/method/state, duplicate
parameters, token parameters and a mismatched optional issuer. Invalid callbacks do
not consume the valid attempt. Listener disposal closes the port on success/failure.
Kestrel logging is disabled; browser responses and console errors are fixed strings.
No request/response body, code, token, provider identity or email is printed.

Credentials are encrypted using DPAPI `CurrentUser` under
`%LOCALAPPDATA%\TimmyAcademy\AuthPoc`, separate from Store application state.
Issuer/client binding supplies DPAPI entropy and a hashed filename. Writes replace
the encrypted file atomically; a file lease prevents concurrent harness instances
for that binding. There is no plaintext fallback. DPAPI does not protect against
another process running as the same Windows user. Tokens necessarily exist in
managed process memory while used; plaintext serialization buffers are cleared.

Provider REST details stay in `ClerkDesktopAdapter`. All HTTP operations disable
redirects/cookies and use bounded response size/timeouts in the executable. Refresh
failure retains the previous encrypted credential, which may already be invalid if
the provider rotated it before a lost response. Persistence failure triggers a
best-effort revoke; network failures can leave remote state unconfirmed. No automatic
retry or assumption of logout hides those cases.

33 local tests pass on Windows: actual callback sockets, the RFC S256 example,
DPAPI round-trip/tampering/binding, exclusive lease, lifecycle retention and stubbed
provider exchanges. They do **not** prove real email delivery, browser SSO, Clerk
code replay protection, revocation or refresh semantics. An HTTP 200 from revoke
alone is not proof: follow it with `check` and `refresh` negative tests.

See [live setup and test sequence](../../infrastructure/auth-poc/live-check.md).
