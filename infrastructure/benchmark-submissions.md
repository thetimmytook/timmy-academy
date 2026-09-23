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
reason codes still need an approved allowlist before being exposed through an API.

The migration rebuilds `benchmark_runs` to allow a null publication timestamp,
copies only writable columns (generated search columns recompute from detail),
and restores the custom public-snapshot revision triggers. It increments the
revision to invalidate existing navigation tokens. Existing public data, IDs,
sequences and publication dates are preserved. The new submissions table starts
empty; fixture contributors are not silently converted into account owners.

Deletion must hide or remove the run and clear the submission link atomically.
Request fingerprinting, retry payload comparison, owner-list cursors, retention
and anonymization remain separate steps. This schema does not implement the
publication or deletion workflows.
