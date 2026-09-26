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

## Decisions

- `POST /api/admin/v1/approvals/:submissionId/approve`
- `POST /api/admin/v1/approvals/:submissionId/reject`

Both routes use the same browser moderator guard and accept no body or query.
They call the atomic approval/rejection repositories. A successful response is
HTTP 200 with `submission_id` and `publication_status` (`published` or `rejected`).
Repeating the same decision returns the same acknowledgement. An opposing decision
or a deleted submission returns 409 `moderation_conflict`; a missing ID returns 404.
Invalid parameters return 422. Mutations retain the browser Origin checks.

## Admin page

The profile menu shows Admin only when the current browser user's public metadata
has the exact `admin` role. `/admin` displays a left menu with Approvals selected,
pending measurements, expandable conditions/metrics/settings, and pagination.
Guest visits offer sign-in with `/admin` as the return destination. The UI role
check controls presentation; the server rechecks authorization for every request.

Approve and Reject each require confirmation. Pending actions disable duplicate
clicks; successful decisions refresh the queue from the first page. A network error
keeps the item available for an idempotent retry. A conflict offers a queue refresh.
Unloading the page, losing the client-side role, signing out or changing sessions
unmounts the private queue and aborts requests; late responses are ignored.
Aborting the browser request does not undo a decision already accepted by the server.

No role-management page or reconsideration workflow is provided. Change roles in
Clerk Dashboard; if the browser still shows old metadata, reload it. Server checks
use the current role regardless of the menu's state.
