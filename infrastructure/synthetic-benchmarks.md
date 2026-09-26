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
and fictional contributor keys. The additional local desktop seed is maintained
under ignored `infrastructure/.wrangler/`; its existing 396 rows were marked
locally and its generator now writes the flag.

When demo data is no longer needed, select rows by `is_synthetic = 1` for a
separately approved cleanup. No automatic cleanup or deletion endpoint is added.
