# Synthetic benchmark measurements

`benchmark_runs.is_synthetic` marks demo measurements. It defaults to `false`;
the submission API does not accept the flag and always stores real submissions
with `false`. Repository seed rows use `true`.

Public run summaries and details expose the required boolean `is_synthetic`,
including search previews, individual results and Position matches. The database
column is authoritative, even if the stored JSON contains a different value.
Clients should label flagged measurements **Demo data**. They participate in the
same filters, counts and Position comparisons as other published measurements.

Migration 0008 marks existing standard seed rows using their reserved test IDs
and fictional contributor keys.

## Optional demo dataset

For staging or production, use the separate **Seed demo data** GitHub Actions
workflow (`.github/workflows/seed-demo.yml`):

1. Open **Actions → Seed demo data → Run workflow**.
2. Select branch **master**.
3. Choose **staging** or **production** (the default is staging).
4. Select **Run workflow**.

The workflow builds the contracts and checks the generator before writing to the
selected remote D1 database. It uses the existing repository secrets
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; local Cloudflare authentication
is not needed. The database must already be migrated by its deployment pipeline.
Seed and deployment share the environment's database concurrency group, so they
do not run at the same time. Runs from other branches skip the seed job.

For local development only, run from the repository root:

```powershell
npm run db:seed:demo:local
```

The pipeline invokes the corresponding `db:seed:demo:staging` or
`db:seed:demo:production` npm script. Deployment never runs demo seed automatically.
The original fixture seed remains restricted to local/staging.

The demo dataset contains 397 measurements: the original 396 across 11 maps,
3 discrete-GPU hardware configurations, 2 execution modes, 2 resolutions
(1080p/1440p), and 3 samples, plus one separate Ryzen 7 7840U / Radeon 780M UMA run.
All use game version `0.16.9.0`, fixed September 2026 dates, fictional contributors
and `is_synthetic = true`. These are invented examples, not measured performance.
They participate in public search and Position under those exact conditions.

The generator is `apps/api/src/benchmark/demo-seed.ts`. It preserves the IDs of
the former local desktop generator (`br_test_desktop_*`), so existing local rows
are not duplicated. The original hardware, FPS metrics, dates, settings and IDs
are preserved when refreshing an existing row. Generated SQL is kept under
ignored `infrastructure/.wrangler/`.

## Capture resource examples

Every generated run includes a synthetic capture-window `resource_telemetry`
summary. Most runs use ordinary values with varying average/minimum/maximum/last.
Adapter labels, VRAM capacity, installed/OS-usable RAM and processor counts match
their fixture hardware. These examples describe invented system/adapter activity,
not per-game memory use or proven causes of FPS drops.

The following cases occur once each in the larger demo dataset:

| Scenario                                                                    | Stable public ID                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------- |
| Near-full discrete VRAM                                                     | `br_test_desktop_0_lighthouse_bsg_servers_1920_1` |
| Low available physical RAM                                                  | `br_test_desktop_0_lighthouse_bsg_servers_1920_2` |
| Low commit headroom                                                         | `br_test_desktop_0_lighthouse_bsg_servers_2560_0` |
| Partial CPU coverage, unavailable GPU counter, unknown pagefile policy      | `br_test_desktop_0_lighthouse_bsg_servers_2560_1` |
| Unavailable resource collection                                             | `br_test_desktop_0_lighthouse_bsg_servers_2560_2` |
| A second HDD pagefile appears mid-capture; allocation and commit limit grow | `br_test_desktop_0_lighthouse_local_1920_0`       |
| UMA with no physical discrete VRAM and measured shared usage                | `br_test_desktop_uma_lighthouse_local_1920_0`     |

The 24 standard fixtures also include the six discrete-GPU scenarios; their IDs,
hardware, conditions and FPS stay unchanged. Standard local/staging fixture seed
continues to insert missing rows only.

## Idempotent demo refresh

The same explicit seed command inserts missing demo runs and refreshes only
`detail.resource_telemetry` in matching existing rows. A conflict update requires
both `is_synthetic = 1` in the authoritative database column and the exact
fictional contributor generated for that exact public ID. Any row linked to a
submission is excluded. A deletion acknowledgement with that public ID also
prevents insertion or refresh.

No other JSON values or columns are updated: sequence, contributor, publication
timestamp, visibility, IDs, hardware, conditions, capture, FPS, settings and
public author remain as stored. Hidden/deleted demo rows stay hidden/deleted.
Unrelated rows, real rows and private submission metadata remain untouched.
There is no bulk update by prefix or flag alone. UMA receives a new ID; existing
discrete-GPU measurements are not converted to UMA.

An unchanged telemetry block skips the UPDATE, so a repeated refresh leaves the
dataset revision unchanged. A changed block advances the existing revision and
invalidates public navigation cursors as usual. If an import is interrupted,
rerunning the same explicit command completes remaining rows safely.

## Prepare a production review without writing data

From the repository root:

```powershell
npm run db:seed:demo:production -- --generate-only
```

This writes `infrastructure/.wrangler/demo-seed-production.sql` locally and exits
before invoking Wrangler. It requires no Cloudflare authentication and performs
no database requests. The file contains 397 guarded INSERT/telemetry-update
statements and invented demo data only. Inspect it together with the generator
and D1 integration tests before separately approving a production application.

The production **Seed demo data** workflow applies this refresh; dispatch remains
an explicitly approved remote write. Deployment does not run it automatically.

When demo data is no longer needed, select rows by `is_synthetic = 1` for a
separately approved cleanup. No automatic cleanup or deletion endpoint is added.
