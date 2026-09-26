# Benchmark moderation

## Access

Assign the role manually in the Clerk Dashboard user record, under public metadata:

```json
{ "role": "admin" }
```

The server's Clerk adapter reads `publicMetadata.role` from its existing Backend API
user lookup on every protected request. Only the exact string `admin` grants the
application capability `canModerate`. Missing or unknown roles grant no permission.
Client-editable unsafe metadata and token role claims are ignored. Removing the
role takes effect on the next request, without waiting for the browser token to
expire. Email verification, session expiry/revocation and origin checks still apply.

The principal carries only the boolean capability; provider metadata is not stored
in benchmark records or serialized in public responses. Desktop sessions cannot
access the admin router. There is no role-assignment endpoint in the application.

## Pending queue

`GET /api/admin/v1/approvals` requires a verified browser moderator before query
validation or repository access. Anonymous requests return 401; authenticated users
without moderator access return 403 `forbidden`. Responses use `Cache-Control: no-store`.

The query accepts `limit` (default 20, maximum 50) and an optional positive integer
`after`. The queue is ordered by submission sequence ascending, oldest first, with
live keyset pagination. `next_after` is the last returned submission sequence when
another page exists, otherwise null. Decisions made between pages remove submissions
from the queue; no snapshot or watermark is maintained.

Each item contains `submission_id`, `submitted_at` and the validated measurement
under `run`. Preallocated public IDs and URLs, owner/client identifiers, fingerprints
and provider identities are omitted. Only pending submissions linked to hidden,
unpublished runs appear. This endpoint never approves or rejects a submission.

This step provides the protected queue. The `/admin` Approvals page, role-only
profile-menu entry and moderator decision endpoints are the next implementation step.
