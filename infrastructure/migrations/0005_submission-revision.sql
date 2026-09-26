-- Owner cursors share the conservative dataset revision with public navigation.
CREATE TRIGGER submission_revision_update AFTER UPDATE ON benchmark_submissions
BEGIN
  UPDATE benchmark_state SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER submission_revision_delete AFTER DELETE ON benchmark_submissions
BEGIN
  UPDATE benchmark_state SET revision = revision + 1 WHERE id = 1;
END;
