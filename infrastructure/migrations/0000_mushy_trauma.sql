CREATE TABLE `benchmark_runs` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`contributor_key` text NOT NULL,
	`published_at` text NOT NULL,
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
	CONSTRAINT "valid_detail" CHECK(json_valid("benchmark_runs"."detail") AND json_extract("benchmark_runs"."detail", '$.public_run_id') = "benchmark_runs"."public_id"),
	CONSTRAINT "valid_visibility" CHECK("benchmark_runs"."visibility" IN ('published', 'hidden', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `benchmark_runs_public_id_unique` ON `benchmark_runs` (`public_id`);--> statement-breakpoint
CREATE INDEX `runs_order` ON `benchmark_runs` (`visibility`,`captured_day`,`published_at`,`public_id`);--> statement-breakpoint
CREATE INDEX `runs_hardware_cohort` ON `benchmark_runs` (`visibility`,`cpu`,`gpu`,`ram_gb`,`map`,`execution`,`game_width`,`game_height`,`game_version`);--> statement-breakpoint
CREATE INDEX `runs_gpu` ON `benchmark_runs` (`visibility`,`gpu`,`ram_gb`);--> statement-breakpoint
CREATE INDEX `runs_map` ON `benchmark_runs` (`visibility`,`map`);--> statement-breakpoint
CREATE INDEX `runs_resolution_version` ON `benchmark_runs` (`visibility`,`game_width`,`game_height`,`game_version`);--> statement-breakpoint
CREATE TABLE `benchmark_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `benchmark_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tokens_expiry` ON `benchmark_tokens` (`expires_at`);