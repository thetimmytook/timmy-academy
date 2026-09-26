CREATE TABLE `benchmark_measurement_archive` (
	`id` text PRIMARY KEY NOT NULL,
	`detail` text NOT NULL,
	CONSTRAINT "valid_archived_measurement" CHECK(json_valid("benchmark_measurement_archive"."detail"))
);
--> statement-breakpoint
ALTER TABLE `benchmark_submissions` ADD `deleted_public_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_deleted_public_id` ON `benchmark_submissions` (`deleted_public_id`);