# Windows error reports — future work

Recorded on 2026-09-26. Deferred: do not implement until explicitly requested.

## Product direction

The Windows application will submit an error report to the Timmy Academy API.
The API will create a GitHub issue in a server-configured repository. GitHub
Issues will be the place to review and track reports; no separate error-report
admin panel is planned. The Windows application will not call GitHub directly
or contain GitHub credentials, and users will not need a GitHub account to report.

This is a separate workflow from benchmark publication and approval. The existing
desktop error-reporting flow remains unchanged until this feature is implemented.

## Proposed implementation constraints

- Send only after an explicit user action, with a preview of the report.
- Define a small structured report contract, including application version,
  operation/error category, sanitized diagnostics and optional user description.
- Validate and sanitize at the API boundary as well as in the client. Do not
  forward arbitrary logs or exception payloads containing credentials, local
  paths, usernames, machine identifiers or other private information.
- Keep GitHub credentials on the server with access limited to the chosen
  repository and issue creation. The client cannot choose the target repository.
- Bound report size and submission frequency. Retrying the same report after
  a lost response should not create another issue. Grouping different reports
  of the same underlying error is a separate decision, not assumed for v1.
- Do not show successful submission before it is durably accepted; define
  retry behavior for GitHub outages and ambiguous create-issue responses.

## Decide when implementation starts

Choose the target repository and whether reports will be public or private;
authentication policy (including failures that prevent sign-in); the exact DTO
and endpoint; GitHub credential type; and the receipt shown to the user.
If issues are public, make that clear before the user sends the report.

GitHub supports issue creation through its
[REST API](https://docs.github.com/en/rest/issues/issues#create-an-issue).
