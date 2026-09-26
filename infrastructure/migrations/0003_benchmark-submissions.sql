-- Rebuild to allow an unpublished run without a publication timestamp.
-- Copy writable columns only and restore the custom revision triggers.
CREATE TABLE `__new_benchmark_runs` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`contributor_key` text NOT NULL,
	`published_at` text,
	`visibility` text DEFAULT 'published' NOT NULL,
	`detail` text NOT NULL,
	`cpu` text GENERATED ALWAYS AS (json_extract(detail, '$.hardware.cpu.id')) VIRTUAL,
	`gpu` text GENERATED ALWAYS AS (json_extract(detail, '$.hardware.gpu.id')) VIRTUAL,
	`ram_gb` integer GENERATED ALWAYS AS (json_extract(detail, '$.hardware.ram_gb')) VIRTUAL,
	`map` text GENERATED ALWAYS AS (json_extract(detail, '$.conditions.map.id')) VIRTUAL,
	`execution` text GENERATED ALWAYS AS (json_extract(detail, '$.conditions.execution')) VIRTUAL,
	`game_width` integer GENERATED ALWAYS AS (json_extract(detail, '$.conditions.game_resolution.width')) VIRTUAL,
	`game_height` integer GENERATED ALWAYS AS (json_extract(detail, '$.conditions.game_resolution.height')) VIRTUAL,
	`game_version` text GENERATED ALWAYS AS (json_extract(detail, '$.conditions.game_version')) VIRTUAL,
	`captured_day` text GENERATED ALWAYS AS (json_extract(detail, '$.captured_day')) VIRTUAL,
	CONSTRAINT "valid_detail" CHECK(json_valid("__new_benchmark_runs"."detail") AND json_extract("__new_benchmark_runs"."detail", '$.public_run_id') = "__new_benchmark_runs"."public_id"),
	CONSTRAINT "published_timestamp" CHECK("__new_benchmark_runs"."visibility" <> 'published' OR "__new_benchmark_runs"."published_at" IS NOT NULL),
	CONSTRAINT "valid_visibility" CHECK("__new_benchmark_runs"."visibility" IN ('published', 'hidden', 'deleted'))
);
--> statement-breakpoint
INSERT INTO `__new_benchmark_runs`("sequence", "public_id", "contributor_key", "published_at", "visibility", "detail") SELECT "sequence", "public_id", "contributor_key", "published_at", "visibility", "detail" FROM `benchmark_runs`;--> statement-breakpoint
DROP TABLE `benchmark_runs`;--> statement-breakpoint
ALTER TABLE `__new_benchmark_runs` RENAME TO `benchmark_runs`;--> statement-breakpoint

CREATE UNIQUE INDEX `benchmark_runs_public_id_unique` ON `benchmark_runs` (`public_id`);--> statement-breakpoint
CREATE INDEX `runs_order` ON `benchmark_runs` (`visibility`,`captured_day`,`published_at`,`public_id`);--> statement-breakpoint
CREATE INDEX `runs_hardware_cohort` ON `benchmark_runs` (`visibility`,`cpu`,`gpu`,`ram_gb`,`map`,`execution`,`game_width`,`game_height`,`game_version`);--> statement-breakpoint
CREATE INDEX `runs_gpu` ON `benchmark_runs` (`visibility`,`gpu`,`ram_gb`);--> statement-breakpoint
CREATE INDEX `runs_map` ON `benchmark_runs` (`visibility`,`map`);--> statement-breakpoint
CREATE INDEX `runs_resolution_version` ON `benchmark_runs` (`visibility`,`game_width`,`game_height`,`game_version`);
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

--> statement-breakpoint
UPDATE benchmark_state SET revision = revision + 1 WHERE id = 1;
--> statement-breakpoint
CREATE TABLE `benchmark_submissions` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`client_run_id` text NOT NULL,
	`submitted_at` text NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`run_sequence` integer,
	`status_reason` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_sequence`) REFERENCES `benchmark_runs`(`sequence`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "submission_status" CHECK("benchmark_submissions"."status" IN ('pending_review', 'published', 'rejected', 'deleted')),
	CONSTRAINT "submission_run_link" CHECK(("benchmark_submissions"."status" = 'deleted' AND "benchmark_submissions"."run_sequence" IS NULL) OR ("benchmark_submissions"."status" <> 'deleted' AND "benchmark_submissions"."run_sequence" IS NOT NULL)),
	CONSTRAINT "submission_reason" CHECK(("benchmark_submissions"."status" = 'rejected' AND "benchmark_submissions"."status_reason" IS NOT NULL AND length(trim("benchmark_submissions"."status_reason")) > 0) OR ("benchmark_submissions"."status" <> 'rejected' AND "benchmark_submissions"."status_reason" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_account_client` ON `benchmark_submissions` (`account_id`,`client_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_run` ON `benchmark_submissions` (`run_sequence`);--> statement-breakpoint
CREATE INDEX `submissions_owner_order` ON `benchmark_submissions` (`account_id`,`submitted_at`,`sequence`);--> statement-breakpoint
CREATE INDEX `submissions_owner_status_order` ON `benchmark_submissions` (`account_id`,`status`,`submitted_at`,`sequence`);
