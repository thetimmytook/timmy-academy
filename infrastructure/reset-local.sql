-- Local-only data reset. Keep schema, migration journal and ingestion sequence intact.
DELETE FROM benchmark_tokens;
DELETE FROM benchmark_runs;
