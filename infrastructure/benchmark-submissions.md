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
Retention and anonymization remain separate steps. This schema does not implement the
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

Apply local migrations before using these endpoints. Submission upload is described below.

## Atomic submission storage

`D1SubmissionWriter.submit(accountId, clientRunId, data, requestFingerprint)` accepts an authenticated
internal account ID, a UUID client ID, and an already normalized public-safe run
document without public ID/URL, plus the validated request fingerprint. This is a private storage boundary, not an upload
contract: capture-quality checks and transport validation belong before it.
The writer still validates the strict document allowlist before any SQL writes.

A single Drizzle D1 batch conditionally inserts the hidden run and its pending-review
submission, then reads the winning submission. Failed inserts roll back the run;
concurrent retries cannot leave unused run records. Public IDs and submission time
are server-generated. The private contributor key uses the stable account ID.
New runs remain invisible to public queries until a separate approval operation.

For an existing account/client pair, the writer compares both the request fingerprint
and the normalized document against stored values, excluding generated ID/URL.
An identical retry returns the existing pending result without changing data, IDs
or submission time. Changed validated content returns `idempotency_conflict`.
This writer currently supports only pending submissions. An existing non-pending
record fails closed and is never replaced. Retry responses after moderation or
deletion will be implemented alongside those workflows.

## Protected submission upload

`POST /api/bench/v1/me/runs` authenticates through the shared owner middleware,
then requires JSON with a streaming 32 KiB limit. It validates the strict DTO,
normalizes the run and atomically stores it as pending. New submissions and exact
retries return 202 with `publication_status: pending_review`, null public ID and
URL, and `Cache-Control: no-store`. No run is automatically published.

The route rejects unauthenticated requests with 401, unsupported media with 415,
oversized bodies with 413, malformed/invalid input or query parameters with 422,
and changed content for an existing account/client ID with 409. Owner identity
comes exclusively from the authenticated principal.

Migration `0006_submission-fingerprint.sql` adds a private SHA-256 fingerprint of
the complete validated DTO, including `app_version`. Schema parsing fixes nested
object-key order before hashing; insignificant JSON formatting does not change
retry identity. The fingerprint is not exposed in owner or public responses.
No second request document is stored. Historical rows have null fingerprints;
a retry cannot establish their full original payload and fails with 409.

Cross-client-ID duplicate detection, quotas, moderation and deletion are not
implemented in this step. Apply the migration before using the POST endpoint.

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
The contract also checks metric consistency as described below. The POST route
uses this contract before normalization and storage; it never publishes automatically.

## Selected settings projection

`projectSubmissionSettings` maps a validated settings snapshot to the explicit
public settings allowlist. It preserves false toggles, zero values and accepted
raw enum codes/tokens. Screen modes map 0/1/2 to fullscreen/borderless/windowed;
`SetAffinityToLogicalCores` maps directly without inversion. Missing fields and
empty output sections are omitted. If only resolution was supplied, settings are
null: the selected screen resolution belongs to run conditions, not settings.
No render-scale or upscaling effects are inferred, and unrelated source keys are
never copied. The hardware and submission normalization below uses this projection; the
observed-value list itself is not a complete hardware catalog.

## Capture metric consistency

The submission contract cross-checks sample count, measured duration, Average FPS
and mean frametime. All three duration intervals must overlap: reported duration,
sample count multiplied by mean frametime, and sample count divided by Average FPS.
Accepted rounding is half of 0.001 seconds for duration and half of 0.01 for FPS
and frametime milliseconds. This supports the documented DTO's two-decimal values;
the current desktop collector retains three decimals for mean frametime. A 1e-9
second slack handles floating-point interval boundaries only.

Source formulas were checked in `TarkovSkills.Core/BenchmarkServices.cs` at desktop
commit `e4526da`: duration is summed valid frametimes, Average FPS is frame count
divided by duration, lows use the slowest ceil(1%/0.1%) samples, and percentiles
use sorted nearest ranks. Require 0.1% low <= 1% low <= Average FPS and P95 <= P99.
Do not require mean frametime <= P95: rare stalls can make the mean larger.
Rejected values are never corrected silently. These arithmetic checks cannot
prove authenticity or reconstruct percentiles without raw frames; no arbitrary
hardware performance threshold or new moderation workflow is introduced.

## Hardware and submission normalization

`normalizeHardware` is shared by submission normalization and both Position
repositories. It trims/collapses whitespace and compares complete names in lower
case. Every model uses the same rule, with no catalog exceptions. Each name gets
`cpu-` or `gpu-` plus the SHA-256 hex digest of that comparison name; its display
label keeps the supplied spelling with normalized whitespace. RAM GB is already
a validated positive integer and is retained unchanged.

Suffixes, punctuation, vendor names and laptop distinctions are not stripped.
Different names are not merged. An alias mechanism will be introduced only when
specific mappings are agreed; fixture names are not aliases or a production
catalog. Test/seed hardware lives in `fixture-hardware.ts` and uses the same
name-derived IDs as other hardware. Old demo IDs are not retained as production
exceptions. Existing demo databases require a deliberate reseed/reset; this code
change does not rewrite stored rows or modify a live database.
An unknown model is valid: Position returns `no_data` if it has no public matches,
and the writer accepts its normalized run as `pending_review`.

`normalizeSubmission` maps the validated DTO to the writer document using those
same IDs and the selected-settings projection. Metrics are preserved; author is
null, quality notes are empty, and render scale/upscaling effects are not inferred.
Client ID, app version and raw settings keys are not copied into public run data.
Map IDs still use the existing reviewed map list; this step does not add maps.
The POST endpoint uses this transformation after validation and fingerprints the
validated input separately to retain complete retry identity.

## My Bench web page

The signed-in profile menu opens `/bench/me`. The page reads the existing owner
list API with status filtering and cursor pagination, and links only published
runs to public detail. It never submits a run. Pending and rejected runs remain
visible only to their owner. No moderation or deletion controls are added here.

Private requests start only after browser sign-in. The list unmounts on logout
and is recreated on a session change; late responses are discarded. A direct
guest visit offers sign-in with a fixed return destination of My Bench. External
return destinations are ignored. BENCH still restores the remembered browse URL.
