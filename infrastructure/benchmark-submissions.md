# Private benchmark submissions

Migration `0003_benchmark-submissions.sql` adds the storage foundation for My Bench.
It does not register routes or assign existing fixture runs to users.

## One copy of the run data

`benchmark_runs.detail` stores the full validated, public-safe run document once,
including settings and metrics. A run can exist here before publication. Pending
and rejected runs use `visibility = hidden` and have no `published_at` timestamp.
A run's opaque ID and URL may be allocated internally before approval; their
existence does not make the run publicly accessible. Owner responses must return
null public IDs and URLs until publication, as specified by the owner contract.

`benchmark_submissions` stores the account foreign key, client run ID, submission
time, status, optional rejection reason and `run_sequence` foreign key. It has no
summary or second detail document. My Bench derives its cards from the linked run.
All non-deleted submissions require a run; a deleted marker has no run link.

Approval updates the existing run's visibility and publication timestamp and the
submission status in one transaction. It does not copy or recreate the detail.
Rejection keeps the run hidden. The future write repository must enforce these
cross-table transitions; schema foreign keys do not synchronize the two states.
Public readers continue to select only `visibility = published` and use explicit
allowlist projections. SQL requires a publication timestamp for visible runs.

## Constraints and migration

The `(account_id, client_run_id)` unique index reserves the client's ID within its
account, including after deletion. Each run can belong to only one submission.
Foreign keys prevent deleting referenced accounts or run records accidentally.
Owner/time and owner/status/time indexes support stable owner lists. Rejection
details remain private. The HTTP API currently exposes only the generic code `rejected`.

The migration rebuilds `benchmark_runs` to allow a null publication timestamp,
copies only writable columns (generated search columns recompute from detail),
and restores the custom public-snapshot revision triggers. It increments the
revision to invalidate existing navigation tokens. Existing public data, IDs,
sequences and publication dates are preserved. The new submissions table starts
empty; fixture contributors are not silently converted into account owners.

Deletion must hide or remove the run and clear the submission link atomically.
Transport-payload fingerprinting, retention and anonymization remain separate steps. This schema does not implement the
publication or deletion workflows.

## Private read repository

`D1SubmissionRepository` requires an internal account ID on both `list` and
`findByClientId`. Every SQL query filters by that account. Missing and foreign
client IDs both return `undefined`; deleted submissions are excluded from lists
and return only a minimal deletion acknowledgement through the lookup.

Cards are projected from the linked detail document. Pending/rejected cards omit
the preallocated public ID and URL. Account IDs, contributor keys, settings and
provider identities are not included. Stored rejection reasons remain private;
the HTTP layer replaces them with the generic code `rejected`.

Lists support status filtering, a default limit of 20 (maximum 50), and keyset
ordering by submission time and private sequence descending. The returned `next`
position is internal repository state, not a public cursor.

## Protected owner reads

- `GET /api/bench/v1/me/runs` accepts `status` (all, published, pending_review or rejected), `limit` (1–50, default 20), and an optional `cursor`.
- `GET /api/bench/v1/me/runs/by-client-id/:clientRunId` accepts a UUID and returns the owner's card or a minimal deleted marker. Missing and foreign IDs both return 404.

Both routes require a verified application principal before validating inputs and
return `Cache-Control: no-store`. Unknown or duplicate query fields are rejected.
There is no request parameter for selecting another account.

The owner cursor is HMAC-signed using `BENCHMARK_CURSOR_SECRET`, bound to a hash
of account ID, status and limit, and valid for 30 minutes from the first page.
The account ID is not serialized in the token. The token is signed, not encrypted;
its internal pagination position is readable. It cannot be used as a public cursor.
Owner pagination follows the current list rather than freezing inserts at the first
page. New submissions below the cursor can appear on subsequent pages; new ones
above it appear after restarting the list. Revision checks before and after reading
detect updates and deletions.

Migration `0005_submission-revision.sql` adds submission update/delete triggers
using the existing dataset revision. Run updates/deletes already increment it.
This deliberately conservative revision invalidates all active owner and public
cursors when a submission changes, including cursors for other accounts. Such
requests return 409 `cursor_stale` and must restart at the first page. Invalid,
altered or differently bound owner cursors return 400 `invalid_cursor`.

Apply local migrations before using these endpoints. This step adds no My Bench UI,
submission upload, moderation or deletion endpoint.

## Atomic submission storage

`D1SubmissionWriter.submit(accountId, clientRunId, data)` accepts an authenticated
internal account ID, a UUID client ID, and an already normalized public-safe run
document without public ID/URL. This is a private storage boundary, not an upload
contract: capture-quality checks and transport validation belong before it.
The writer still validates the strict document allowlist before any SQL writes.

A single Drizzle D1 batch conditionally inserts the hidden run and its pending-review
submission, then reads the winning submission. Failed inserts roll back the run;
concurrent retries cannot leave unused run records. Public IDs and submission time
are server-generated. The private contributor key uses the stable account ID.
New runs remain invisible to public queries until a separate approval operation.

For an existing account/client pair, the writer compares the normalized document
against the stored detail, excluding the generated ID/URL. Schema parsing fixes
JSON object-key order before comparison; no second document or hash column is
stored. An identical retry returns the existing pending result without changing
data, IDs or submission time. A changed document returns `idempotency_conflict`.
This writer currently supports only pending submissions. An existing non-pending
record fails closed and is never replaced. Retry responses after moderation or
deletion will be implemented alongside those workflows.

This compares normalized storage data, not a future raw upload envelope. When the
upload contract is introduced, any additional fields relevant to retry identity
must be accounted for explicitly. Cross-client-ID duplicate detection, quotas,
moderation writes and the POST endpoint are not implemented by this step.

## Submission transport contract

`submissionRequestSchema` in `packages/contracts` defines the version-1 request
from the backend design. It is separate from the writer's normalized storage input.
`settingsSnapshotSchema` accepts only the reviewed saved-key paths from
`design/benchmark-settings-allowlist.md`; unknown fields fail rather than being
silently discarded. Missing settings remain missing, and `false` is retained.
Empty settings sections must be omitted; use `settings_snapshot: null` when no
reviewed settings are available.

The structural contract requires at least 110 measured seconds and 120 frame
samples. A settings resolution, when provided, must match `game_resolution`.
These checks do not establish capture plausibility: metric consistency checks,
normalization, intake metadata/idempotency handling and request body limits still
need implementation before connecting the POST route. This schema adds no route
or automatic publication behavior.

## Selected settings projection

`projectSubmissionSettings` maps a validated settings snapshot to the explicit
public settings allowlist. It preserves false toggles, zero values and accepted
raw enum codes/tokens. Screen modes map 0/1/2 to fullscreen/borderless/windowed;
`SetAffinityToLogicalCores` maps directly without inversion. Missing fields and
empty output sections are omitted. If only resolution was supplied, settings are
null: the selected screen resolution belongs to run conditions, not settings.
No render-scale or upscaling effects are inferred, and unrelated source keys are
never copied. Hardware canonicalization and full submission normalization remain
separate work; the existing observed-value lookup is not a production catalog.
