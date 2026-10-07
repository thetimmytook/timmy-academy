# Capture resource contract and desktop handoff

The Academy API and web implementation require `resource_telemetry` in version-1
submissions and stored run detail. The desktop-session handoff reports that
`C:/projects/tarkov-skills` now collects NVIDIA NVAPI graphics-domain utilization and
AMD ADLX GPUUsage, with adapter memory still collected separately through Windows.
Its vendor-source send guard depends on Academy accepting those sources.
The vendor-source patch dated 2026-10-07 is prepared locally for review; it has not
been deployed or applied to any existing dataset. The earlier full-summary dataset
transition completed on staging and production on 2026-10-06. Desktop code and the
Store release remain separate work; this session does not change that repository.

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

| Field                                                 | Shape / unit     | Exact source                                                                             | Scope               |
| ----------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- | ------------------- |
| `cpu.total_utilization`                               | Metric / percent | `pdh_processor_information_processor_time`                                               | `whole_system`      |
| `cpu.logical_processors[].utilization`                | Metric / percent | `pdh_processor_information_processor_time`                                               | `logical_processor` |
| `gpu.dedicated_vram_capacity`                         | Capacity / bytes | `dxgi_dedicated_video_memory` or, for UMA, `d3d12_unified_memory_no_discrete_vram`       | `whole_adapter`     |
| `gpu.graphics_utilization`                            | Metric / percent | `pdh_gpu_engine_3d_busiest_engine`, `nvapi_gpu_graphics_utilization` or `adlx_gpu_usage` | `whole_adapter`     |
| `gpu.dedicated_memory_used`                           | Metric / bytes   | `pdh_gpu_adapter_memory_dedicated`                                                       | `whole_adapter`     |
| `gpu.shared_memory_used`                              | Metric / bytes   | `pdh_gpu_adapter_memory_shared`                                                          | `whole_adapter`     |
| `ram.installed_capacity`                              | Capacity / bytes | `get_physically_installed_system_memory`                                                 | `whole_system`      |
| `ram.os_usable_capacity`                              | Capacity / bytes | `get_performance_info_physical_total`                                                    | `whole_system`      |
| `ram.physical_used`, `ram.physical_available`         | Metric / bytes   | `get_performance_info`                                                                   | `whole_system`      |
| `pagefile.file_count`                                 | Metric / count   | `enum_page_files`                                                                        | `whole_system`      |
| `pagefile.allocated`, `pagefile.used`                 | Metric / bytes   | `enum_page_files`                                                                        | `whole_system`      |
| `pagefile.files[].allocated`, `pagefile.files[].used` | Metric / bytes   | `enum_page_files`                                                                        | `pagefile`          |
| `commit.used`, `commit.limit`, `commit.headroom`      | Metric / bytes   | `get_performance_info`                                                                   | `whole_system`      |

The three graphics-utilization sources above are the complete allowlist. Unknown
sources, null/omitted sources, different units/scopes and extra nested properties
are rejected. This is an additive schema-version-1 change; existing Windows-source
payloads, nullability, statistics, coverage, array and 256 KiB body limits remain.
The existing sample-support rule remains: PDH percent counters permit at most 1.5
supported seconds per sample; vendor gauges permit at most one second. This support
cap does not specify the vendor API's averaging period.

Web detail and owner cards label the Windows source **Windows 3D utilization** and
NVAPI/ADLX **Vendor GPU graphics load**, with the exact source and `whole_adapter`
scope visible. NVIDIA documents the graphics-domain percentage as busy time over
the trailing one-second interval in
[NVAPI](https://docs.nvidia.com/nvapi/struct_n_v___g_p_u___d_y_n_a_m_i_c___p_s_t_a_t_e_s___i_n_f_o___e_x.html).
The [ADLX GPUUsage documentation](https://gpuopen.com/manuals/adlx/adlx-sdk-references/adlx-interfaces/performance-monitoring/iadlxgpumetrics/gpuusage/)
does not specify its averaging period. Do not treat these percentages as
mathematically equivalent or infer a proven cause of FPS drops from a load value
alone. Dedicated/shared GPU memory keeps its separate Windows sources and describes
the entire selected adapter, including other applications.

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

## Original full-summary desktop implementation checklist

Sources below are relative to `C:/projects/tarkov-skills`; this repository does not edit them.
This is the original sender handoff from the full-summary transition, retained for
desktop verification. Statements about the old sender/outbox describe that baseline;
their current implementation status has not been audited in this session. The
vendor-source delta and unblock criteria are below.

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

The agreed transition discarded old benchmark data; there is no legacy API/stored-data
fallback. The reset retained tables, accounts/provider identities, migration history,
revision state and sequence counters. It cleared submissions before linked runs, plus
the closed measurement archive. Old submission statuses and idempotency records were
removed. Ordinary deploy and seed commands do not reset data.

Local reset and fresh demo seed were performed on 2026-10-05: 397 published synthetic
runs, zero submissions/archive entries, with the account and identity preserved.
The existing local reset script leaves the archive intact; it was already empty.
`db:seed:local` inserts missing standard fixtures only and cannot repair old rows.
`db:seed:demo:local` inserts missing demo and refreshes their guarded telemetry blocks.

The remote transition used two independent manual steps:

1. The [production read-only audit](https://github.com/thetimmytook/timmy-academy/actions/runs/37501604014)
   verified the owner mapping from `br_d6441fbb-c0af-4db4-9f56-254826da628e` and
   counted one published owner submission, with zero other authenticated submissions
   across all statuses. This was the pre-reset snapshot; synthetic fixtures were excluded.
2. The approved reset and demo seed completed on
   [staging](https://github.com/thetimmytook/timmy-academy/actions/runs/37508960490) and
   [production](https://github.com/thetimmytook/timmy-academy/actions/runs/37509699898),
   both against merged commit `3de32b040083ef12881e25640ae06496e29f10de`.

| Environment | Runs before | Submissions before | Runs after (all synthetic) | Submissions / archive after | Accounts / identities after | Revision before → after |
| ----------- | ----------: | -----------------: | -------------------------: | --------------------------: | --------------------------: | ----------------------- |
| Staging     |         422 |                  0 |                        397 |                       0 / 0 |                       1 / 1 | 27 → 449                |
| Production  |         397 |                  1 |                        397 |                       0 / 0 |                       1 / 1 | 3 → 401                 |

Production previously contained 396 synthetic runs plus the owner's one real run.
The reset removed all old benchmark submissions, runs and archive entries, then
inserted 397 fresh demo runs. Account and identity counts remained unchanged in both
environments. Each reset used one SQL import containing the three deletes followed
by the full demo seed, with explicit confirmation and reviewed audit acknowledgement;
production approval was checked again immediately before mutation.

After reset, all **13 Bruno smoke checks and 8 telemetry scenarios** passed against
each environment's public API, including search/pagination, detail, Position,
validation failures, unavailable readings, multiple pagefiles and UMA. This verifies
the dataset and public API. Owner/moderator flows and selected-run submission from
the updated desktop still need separate end-to-end verification; the Windows sender
change and its consent/privacy update remain pending. Old Store clients without the
required telemetry block are rejected.

The temporary reset workflow and its script/tests are retired after this transition.
There is no reusable remote reset command. The read-only audit remains available,
but its old default run was deleted by the reset: a future audit must supply a currently
published real run owned by the requester in the selected environment. An unavailable
owner mapping is not zero other users. Any future destructive dataset operation
requires a newly reviewed scope and explicit authorization; ordinary deployment and
demo seeding preserve existing data.

## Vendor-source patch: checks and rollout (2026-10-07)

The contract now accepts the exact three source literals above. Submission
normalization, stored detail, moderation and public/owner projections already copy
the source explicitly; no data rewrite, database migration or new grouping key is
needed. The complete parsed request fingerprint includes source, so changing it
under an existing client ID conflicts. Exact frozen retries keep their original
source. FPS duplicate detection, search groups, cohorts and Position still exclude
resource telemetry from their criteria.

`GraphicsUtilizationSource` is inferred from the graphics metric schema as the
closed union of those three literals. Metric builders, unavailable fixtures and
projections preserve source types; the contracts fixture reuses the exported type.
Web detail and owner cards share one exhaustive, typed `{ label, description }`
mapping, so a source addition requires a matching display entry at compile time.
There are no fallback labels/descriptions for an unknown source.

Automated checks cover all three sources with measured, partial and unavailable
GPU metrics; explicit nulls and not-collected summaries; unchanged Windows support;
unknown sources; forbidden nested fields and the explicit public allowlist; maximum
processor/pagefile arrays and the existing payload boundary. D1/API tests follow
submission → exact retry → moderation queue/approval → owner list/lookup → anonymous
public detail, comparing the full resource block in storage/moderation/public and
the exact aggregate block in owner responses. Separate tests verify source-only
idempotency conflicts and FPS duplicate rejection under a new client ID.

Initial vendor-patch validation completed: **149** contract tests, **548** API tests, **153** web
tests and **16** infrastructure tests; typecheck, lint, formatting and the full build
(including Wrangler's Worker dry run) passed. The default 5-second API test limit
timed out in the existing owner-pagination test that inserts 21 rows. That file
passed separately, and the full API suite passed with
`npm run test -w @timmy/api -- --testTimeout=15000`. No test assertions or repository
timeout settings were relaxed. Remote Bruno checks and the desktop selected-run
flow are prepared below and have not been executed for this patch.

The P2 source-type follow-up passed **150** contract tests (including an exact
literal-union assertion for full/owner contracts), **153** web tests and **30** API
projection/fixture/demo-seed tests. Full typecheck, lint and build passed again;
formatting was checked. This follow-up changes typing and consolidates display
metadata; runtime validation, payloads and dataset/deployment state are unchanged.

The demo generator retains **397** synthetic runs: **395** Windows-source captures,
**1** NVAPI capture and **1** ADLX UMA capture. Windows, partial/unavailable, pressure,
multiple-pagefile and UMA scenarios remain. Vendor examples are:

- NVAPI: `br_test_desktop_0_lighthouse_local_1920_1` (GeForce RTX 4070 SUPER).
- ADLX: `br_test_desktop_uma_lighthouse_local_1920_0` (Radeon 780M, UMA).

The existing `demoSeedStatements` guard is unchanged. Conflict updates modify only
`resource_telemetry` for generated IDs with `is_synthetic = 1`, the exact fixture
contributor and no linked submission. Deletion acknowledgements are respected.
Tests exercise older Windows-source rows transitioning to both vendor sources,
idempotent reruns and protection of real/foreign/linked rows, IDs, visibility and
other content. These tests use isolated ephemeral D1 databases; they do not reset
local, staging or production data.

**Current state:** fixtures are updated locally. The existing generator prepared
397 guarded statements in ignored `infrastructure/.wrangler/demo-seed-staging.sql`
using `npm run db:seed:demo:staging -- --generate-only`, without contacting D1.
Existing local/staging/production demo rows have not been updated in this session.
No deploy, reset or selected-run upload was performed. Production
deployment and demo update require a separate decision.

### Prepared staging sequence

1. Review this patch, then separately authorize the staging API/web deployment of
   the reviewed revision. Deploy before seeding vendor DTOs: the old API rejects
   them. No migration is added. The normal deploy pipeline does not seed data and
   requires separate production approval; do not approve production for this check.
2. Generate reviewable SQL with
   `npm run db:seed:demo:staging -- --generate-only`. This writes ignored
   `infrastructure/.wrangler/demo-seed-staging.sql` without contacting D1. After
   authorization, use `npm run db:seed:demo:staging` or the existing **Seed demo data**
   workflow with **staging** selected, from the reviewed revision available on
   `master`. Use no reset. Compare pre/post counts and confirm real submissions and
   their stored blocks are unchanged; total counts may exceed 397 if real runs exist.
   Rerunning the seed should make no further changes. Protected/conflicting fixture
   IDs may retain their previous block by design; do not bypass the guard.
3. Read the Windows example
   `br_test_desktop_0_lighthouse_bsg_servers_1920_0` and both vendor examples through
   `GET /api/bench/v1/runs/{public_run_id}`. Verify the exact source, full summary,
   `percent`, `whole_adapter`, and independent Windows memory sources. Run the Bruno
   smoke and Resource telemetry collection against staging; check the source labels,
   scope, coverage and vendor explanation in web detail and owner cards.
4. In the desktop session, validate a new run selected by the user against this
   contract, including all required nullable keys and the full resource summary.
   Confirm the staged endpoint supports its exact vendor source before removing the
   local vendor-source block for that environment. Review the frozen prepared DTO;
   preserve its source and all summary values. Sign-in, capture and history must not
   send it. Only the user's **Send for review** action starts submission.
5. Verify the pending owner card/lookup retains source and the aggregate summary,
   while anonymous detail remains inaccessible. An authorized moderator inspects
   the full block in `GET /api/admin/v1/approvals`, then explicitly approves that
   selected submission. Read its public detail and compare every resource summary
   field, processor/file summaries, window metadata, reasons and source to the frozen
   request. Owner responses omit only the existing processor/file arrays; receipts
   remain minimal. Verify exact retry keeps the stored block unchanged and no private
   identifiers/raw samples appear in public output. Do not upload extra measurements
   automatically for verification.

### Desktop-session handoff

Use schema version **1** and the existing `resource_telemetry.gpu.graphics_utilization`
field. Allow exactly `pdh_gpu_engine_3d_busiest_engine`,
`nvapi_gpu_graphics_utilization`, `adlx_gpu_usage`; preserve the collector's original
source, statistics, nulls, coverage and whole-adapter scope in saved runs and frozen
requests. Keep dedicated/shared memory on their Windows sources. Do not regenerate
or relabel frozen requests, resubmit deleted publications or create automatic sends.
Remove the local vendor-source send guard only after the intended environment has
the reviewed API deployed and its vendor public-detail checks pass. Staging success
does not authorize enabling production: that API deployment is agreed separately.
