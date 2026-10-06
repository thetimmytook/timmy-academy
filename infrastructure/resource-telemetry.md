# Capture resource contract and desktop handoff

The Academy API and web implementation require `resource_telemetry` in version-1
submissions and stored run detail. The Windows sender in `C:/projects/tarkov-skills`
still excludes it. This document specifies that separate desktop change; no desktop
code, Store release or remote rollout is performed by this documentation step.

## Wire contract

`POST /api/bench/v1/me/runs` accepts authenticated JSON up to **262,144 UTF-8 bytes**
(256 KiB). Both the request and its resource block use `schema_version: 1`.
The exact executable contracts are
[`submission.ts`](../packages/contracts/src/submission.ts),
[`resource-telemetry.ts`](../packages/contracts/src/resource-telemetry.ts) and
[`resource-metric.ts`](../packages/contracts/src/resource-metric.ts).
All objects are strict allowlists. Required nullable keys remain present with `null`;
omitting the block, sending `null` or adding unknown nested fields returns
`422 invalid_input`. Oversized requests return `413 payload_too_large`.

| Resource root key                         | Required value                                           |
| ----------------------------------------- | -------------------------------------------------------- |
| `schema_version`                          | `1`                                                      |
| `status`                                  | `available`, `partial`, `unavailable` or `not_collected` |
| `window`                                  | Capture alignment and support metadata below             |
| `cpu`, `gpu`, `ram`, `pagefile`, `commit` | Complete sections below, even when unavailable           |
| `warnings`                                | Unique fixed reason codes; at most 16                    |

| Window key               | Accepted value                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `requested_duration_sec` | `120` or `240`; `0` only for `not_collected`                                                  |
| `duration_sec`           | Positive measured interval-union seconds, or `null` if unaligned                              |
| `target_interval_sec`    | `1`                                                                                           |
| `expected_sample_count`  | Nonnegative integer; ceiling of measured duration with rounding tolerance; `0` when unaligned |
| `alignment`              | `presentmon_qpc_valid_frame_intervals` when measured, otherwise `unknown`                     |
| `coverage_method`        | `valid_interval_duration_gauges_capped_at_one_second`                                         |

Each sampled metric contains **all** of these keys:

| Metric key                              | Accepted value                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `average`, `minimum`, `maximum`, `last` | Finite nonnegative number or `null`; percent values are at most 100; other values are at most `Number.MAX_SAFE_INTEGER` |
| `valid_sample_count`                    | Integer from 0 through 10,000                                                                                           |
| `valid_duration_sec`                    | Finite nonnegative supported seconds                                                                                    |
| `coverage`                              | Finite fraction from 0 through 1                                                                                        |
| `unit`, `source`, `scope`               | Exact literals from the field table below                                                                               |
| `status`                                | `available`, `partial` or `unavailable`                                                                                 |
| `reason_codes`                          | Unique fixed reason codes; at most 16                                                                                   |

Measured statistics must lie within minimum/maximum and have samples and supported
duration. An unavailable metric has four null statistics, zero count/duration/coverage
and at least one non-`partial_coverage` reason. A partial metric has measured values,
incomplete coverage and exactly `partial_coverage`. Available metrics have complete
coverage and no reasons. Sampled file-count minimum/maximum/last are integers; its
duration-weighted average may be fractional. Zero is retained only when measured.

Capacities contain `value`, `unit`, `source`, `scope`, `status`, `reason_codes`.
`value` is a nonnegative safe integer in bytes or `null`; status is `available` or
`unavailable`. Available capacities have a value and no reasons; unavailable ones
have null and non-partial reasons. UMA's known zero discrete VRAM is available.

| Field                                                 | Shape / unit     | Exact source                                                                       | Scope               |
| ----------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- | ------------------- |
| `cpu.total_utilization`                               | Metric / percent | `pdh_processor_information_processor_time`                                         | `whole_system`      |
| `cpu.logical_processors[].utilization`                | Metric / percent | `pdh_processor_information_processor_time`                                         | `logical_processor` |
| `gpu.dedicated_vram_capacity`                         | Capacity / bytes | `dxgi_dedicated_video_memory` or, for UMA, `d3d12_unified_memory_no_discrete_vram` | `whole_adapter`     |
| `gpu.graphics_utilization`                            | Metric / percent | `pdh_gpu_engine_3d_busiest_engine`                                                 | `whole_adapter`     |
| `gpu.dedicated_memory_used`                           | Metric / bytes   | `pdh_gpu_adapter_memory_dedicated`                                                 | `whole_adapter`     |
| `gpu.shared_memory_used`                              | Metric / bytes   | `pdh_gpu_adapter_memory_shared`                                                    | `whole_adapter`     |
| `ram.installed_capacity`                              | Capacity / bytes | `get_physically_installed_system_memory`                                           | `whole_system`      |
| `ram.os_usable_capacity`                              | Capacity / bytes | `get_performance_info_physical_total`                                              | `whole_system`      |
| `ram.physical_used`, `ram.physical_available`         | Metric / bytes   | `get_performance_info`                                                             | `whole_system`      |
| `pagefile.file_count`                                 | Metric / count   | `enum_page_files`                                                                  | `whole_system`      |
| `pagefile.allocated`, `pagefile.used`                 | Metric / bytes   | `enum_page_files`                                                                  | `whole_system`      |
| `pagefile.files[].allocated`, `pagefile.files[].used` | Metric / bytes   | `enum_page_files`                                                                  | `pagefile`          |
| `commit.used`, `commit.limit`, `commit.headroom`      | Metric / bytes   | `get_performance_info`                                                             | `whole_system`      |

`cpu.logical_processors` is required, has at most 512 entries and unique `(group, index)`
pairs. `group` is an integer 0–65,535 and `index` is an integer 0–63. Each entry
contains only `group`, `index`, `utilization`. Do not infer absent processors' readings.

`gpu` also requires these metadata keys:

- `adapter_name`: sanitized model label, 1–160 characters, or `null`; no control
  characters, `:`, `@`, slashes/backslashes, UUIDs or IPv4-shaped strings.
- `scope`: `whole_adapter`.
- `memory_architecture`: `discrete`, `unified` or `unknown`.
- `selection_method`: `tarkov_graphics_activity`, `single_hardware_adapter` or `unknown`.
- `selection_status`: `selected` or `unknown`.

Unknown selection means null adapter name, unknown method/architecture and unavailable
GPU metrics/capacity. Known discrete capacity must be positive and bound peak dedicated
usage. Unified memory uses available capacity `0` with the UMA source; dedicated usage
need not be zero because it can represent reserved system RAM. Shared usage is RAM,
not extra physical VRAM. OS-usable capacity cannot exceed installed capacity, and
physical used/available peaks cannot exceed known OS-usable capacity.

`pagefile` additionally requires nullable boolean `automatic_management`,
`automatic_management_source: win32_computer_system_automatic_managed_pagefile`,
`automatic_management_scope: system_policy`, and `files`. This is global Windows
policy, not a per-file management flag. `files` has at most 32 entries with unique
integer `index` values 1–32. Each contains only `index`, `drive_media_type`
(`HDD`, `SSD`, `SCM`, `unknown`), `allocated` and `used`; no path or drive letter.

Reason codes are `not_collected`, `counter_unavailable`, `window_unavailable`,
`summary_unavailable`, `collector_unavailable`, `active_adapter_unknown`,
`multiple_active_adapters`, `linked_adapter_unsupported`, `memory_architecture_unknown`,
`partial_coverage`, `pagefile_management_unknown`. Root warnings are the union of core
metric, logical-processor and capacity reasons, plus `pagefile_management_unknown`
when policy is null. Per-file-only reasons do not enter this root union.

Overall `unavailable` means every core sampled metric is unavailable; static capacities
can still be known. Overall `available` requires all core metrics and listed logical
processors available, known capacities and known pagefile policy. Other collected
states are `partial`. `not_collected` requires requested duration 0, null duration,
unknown alignment, zero expected samples, all metrics/capacities unavailable, empty
processor/file arrays, null policy and a `not_collected` warning. It describes an
explicit absence of collection, not an adapter for an omitted legacy request field.

Core rounds support seconds and coverage to six decimals independently. Preserve those
values; do not round bytes to displayed GiB or recalculate coverage from rounded
numbers. Bounds and tolerances are centralized in
[`resource-telemetry-precision.ts`](../packages/contracts/src/resource-telemetry-precision.ts).
Telemetry duration is the QPC frame-interval union; FPS duration sums frametimes.
The union may be shorter. The submission check allows only independently rounded
durations and Core's at-most-one-microsecond merged gaps between frame intervals.

## Visibility, retries and sharing

| Boundary                                              | Telemetry content                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Submission / stored run                               | Full validated block, stored once                                       |
| Anonymous published detail / private moderator detail | Full projected block with processor/file summaries                      |
| Owner list / lookup                                   | Aggregate block, omitting `cpu.logical_processors` and `pagefile.files` |
| Search previews / groups / Position                   | No telemetry; grouping and comparison criteria unchanged                |
| POST receipts / deleted lookup marker                 | No telemetry                                                            |
| Closed deletion archive                               | No telemetry; original block is deleted with the run                    |

The server fingerprints the complete parsed request, including telemetry and app
version. Exact retry under the same account/client ID returns the existing receipt.
Changing telemetry under that ID returns `409 idempotency_conflict`; changing object
key order does not. A new client ID does not bypass FPS duplicate detection: that
comparison intentionally excludes telemetry. Deleted client IDs remain reserved and
return `409 publication_deleted` until an explicitly approved dataset reset removes
the records. No client fingerprint needs to be submitted.

Proposed English desktop sharing text, to replace the existing "telemetry stays local"
sentence before releasing the sender:

> Only the selected run is sent after you choose Send for review. It includes hardware
> models, map, conditions, approved settings, FPS/frametime metrics and capture-resource
> summaries for CPU, GPU, RAM, pagefiles and system commit. CPU and memory describe the
> whole system; GPU measurements describe the selected adapter, including other
> applications. Signing in does not upload results. The summary becomes public only
> after moderator approval.
>
> Deleting a publication removes its resource summary. A smaller measurement without
> dates, source IDs or your account link remains in an internal analysis archive.

The corresponding privacy description must state that raw samples/time series, process
IDs, other application names, paths, drive letters, LUID/PCI/PnP/device IDs, account
identifiers and native error text are excluded from the benchmark DTO and public
projection. Private authentication and ownership data remain separate. Deletion removes
the telemetry block; the smaller unlinked measurement archive does not retain it.
Minima/peaks describe this capture, not Windows uptime; commit, resident RAM and pagefile
use/allocation are separate measurements. One peak does not establish a cause of FPS drops.

## Desktop implementation checklist

Sources below are relative to `C:/projects/tarkov-skills`; this repository does not edit them.

1. **`src/TarkovSkills.Core/Academy/SubmissionPayload.cs` — `Create`.** Project
   `run.ResourceTelemetry` into the exact nested allowlist, with snake_case via the
   existing `JsonDefaults.Options`. Copy summary fields only, never serialize the whole
   run/system/context or internal collector objects. Retain all required null keys.
   Legacy local runs expose `ResourceTelemetry.NotCollected`; project that explicit
   block rather than omit it or invent measurements. Preserve the collector's measured
   adapter separately from the hardware dropdown; never relabel its statistics based on
   a UI selection, merge GPUs or invent an adapter when selection is unknown.
2. **`SubmissionPayload.ValidateStored`.** Strictly validate the required telemetry,
   including unknown nested properties, and restore it when reconstructing the run
   before reprojection. Its current reconstruction defaults to `NotCollected` and
   would reject/drop a real summary. Preserve window metadata and apply the API's
   numeric/status/array consistency rules; do not silently correct malformed saved DTOs.
3. **`SubmissionOutbox.cs`.** Update both the saved-file and new UTF-8 body limits
   from 32,768 to 262,144 bytes. Freeze the complete request before consent/send and
   retain its exact content for retries. A frozen pre-change DTO without telemetry
   must fail current-contract validation and receive an explicit unsupported-payload
   message; do not silently regenerate it, append telemetry, invent a UUID or auto-send.
   Cleanup/rebuilding a local development outbox after the approved server reset is
   a separate explicit operation, followed by renewed selected-run review.
4. **`SubmissionWorkflow.cs` / receipts.** Keep authenticated owner lookup before an
   uncertain retry, credential binding, account-switch safeguards and deletion tombstones.
   Added telemetry in owner cards must not enter minimal receipt/checkpoint storage.
   A historical local status plus server 404 after reset is not authority to republish;
   the current workflow correctly refuses that retry. Do not bypass it for this rollout.
5. **`src/TarkovBenchmark.Feature/SubmissionWindow.xaml`, `PRIVACY.md` and
   `references/resource-telemetry.md`.** Replace the old local-only claim with the sharing
   scope above. Update review of the prepared selected run in both Store hosts. Preserve
   explicit **Send for review**, moderator approval and absence of automatic uploads.
6. **Contract tests.** Extend `Authentication/SubmissionTests.cs` and
   `SubmissionWorkflowTests.cs`, using `ResourceSummaryTests.cs` and
   `ResourceCaptureContractTests.cs` summaries. Cover measured/partial/unavailable/UMA,
   explicit legacy `NotCollected`, null preservation, array bounds, forbidden fields,
   both outbox size checks, frozen retries, changed-payload conflicts and unsupported
   old outbox DTOs. Keep sign-in/history/collection/Position from initiating upload.
   Validate representative C# JSON against Academy `submissionRequestSchema` before
   staging end-to-end testing. Do not send raw capture fixtures.

## Dataset transition and rollout

The agreed transition discards old benchmark data; there is no legacy API/stored-data
fallback. Reset **data**, retaining tables, accounts/provider identities, migration
journal, revision state and sequence counters. Clear submissions before linked runs,
and clear the closed measurement archive. Old statuses and idempotency records disappear.
Ordinary deploy and seed commands must not become implicit reset operations.

Local reset and fresh demo seed were performed on 2026-10-05: 397 published synthetic
runs, zero submissions/archive entries, with the account and identity preserved.
The existing local reset script leaves the archive intact; it was already empty.
`db:seed:local` inserts missing standard fixtures only and cannot repair old rows.
`db:seed:demo:local` inserts missing demo and refreshes their guarded telemetry blocks.

The rollout has two separate manual steps. Neither workflow triggers the other:

1. **Review existing senders.** After merge, run **Audit benchmark submissions** for
   production while the known owner's run still exists, using
   `br_d6441fbb-c0af-4db4-9f56-254826da628e`. Review the **Other users** totals and
   status rows in the Actions summary. If another user's data would be removed,
   explicitly decide whether the full reset is still approved before continuing.
   An unavailable audit is not zero other users. For a staging audit, supply one of
   your published staging runs so that the target issuer/account mapping is verified.
2. **Reset and seed the approved target.** Run the temporary **Reset benchmark dataset**
   workflow from `master`, choose `staging` or `production`, check `audit_reviewed`
   only after reviewing the report and approving the deletion scope, and enter exactly
   `RESET staging` or `RESET production`. This acknowledgement is manual; the workflow
   does not independently verify a prior audit run or assume zero other users.

The reset deletes **all** submissions, runs and closed measurement archive entries in
the selected database, including other users' records if present. It builds one SQL
file containing those three deletes followed by all 397 demo statements and executes
one remote `wrangler d1 execute --file` import. D1 owns the import transaction; do not
add explicit `BEGIN`/`COMMIT` or split reset and seed into separate calls. Remote import
failure returns the database to its pre-import state, as documented by
[Cloudflare](https://blog.cloudflare.com/building-d1-a-global-database/). SQL generated
under `infrastructure/.wrangler` is ignored and contains only synthetic seed documents.
The workflow performs no migrations, build of the deploy artifact, or deployment.

The workflow validates a manual `master` run, target-specific confirmation and reviewed
audit before accessing D1. Production requires configured Environment reviewers and
approval; the script rechecks the current rules and actual approval for this run
immediately before mutation. Reset uses the same per-environment database concurrency
group as deploy/seed. Aggregate before/after counts are written to the Actions summary;
afterward it checks 397 synthetic runs, empty submissions/archive, unchanged account
and identity counts, and a non-decreasing revision. Schema, identity contents, migration
history and sequence preservation are covered by the local SQL tests.

For staging, wait for the matching automatic deploy after merge, then perform step 2
and verify the contract, public/owner/moderator reads and selected-run submission flow
with the updated desktop. Old details can fail between deploy and reset; deployment
alone does not migrate stored JSON. After staging passes, approve promotion of the
tested artifact to production and perform the production reset in the coordinated
window. Pause submissions/moderation/deletion writes for that window; workflow
concurrency serializes jobs but does not block HTTP writers. These workflows do not
implement a maintenance mode. Verify reads and reopen submissions with the new sender;
old Store clients without the required block will be rejected.

If import completion or post-reset verification is uncertain, inspect the database
before retrying: a rerun deletes the entire current dataset again, including any new
submissions. Preparing these workflows does not dispatch them. Remove the temporary
reset workflow and its script/tests after both environments have completed the transition.
