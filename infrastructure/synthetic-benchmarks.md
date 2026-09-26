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

The demo dataset contains 396 published measurements: 11 maps, 3 hardware
configurations, 2 execution modes, 2 resolutions (1080p/1440p), and 3 samples.
All use game version `0.16.9.0`, fixed September 2026 dates, fictional contributors
and `is_synthetic = true`. These are invented examples, not measured performance.
They participate in public search and Position under those exact conditions.

The generator is `apps/api/src/benchmark/demo-seed.ts`. It preserves the IDs of
the former local desktop generator (`br_test_desktop_*`), so existing local rows
are not duplicated. Inserts use `ON CONFLICT(public_id) DO NOTHING`: reruns never
overwrite real records or republish hidden/deleted rows. Generated SQL is kept
under ignored `infrastructure/.wrangler/`.

When demo data is no longer needed, select rows by `is_synthetic = 1` for a
separately approved cleanup. No automatic cleanup or deletion endpoint is added.
