-- Drizzle custom migration: SQLite triggers are not represented by schema.ts.
INSERT INTO benchmark_state(id, revision) VALUES (1, 0);
--> statement-breakpoint
CREATE TRIGGER benchmark_revision_update AFTER UPDATE ON benchmark_runs
BEGIN
  UPDATE benchmark_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER benchmark_revision_delete AFTER DELETE ON benchmark_runs
BEGIN
  UPDATE benchmark_state SET revision = revision + 1 WHERE id = 1;
END;
