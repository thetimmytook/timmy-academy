ALTER TABLE `benchmark_runs` ADD `is_synthetic` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Recognize only the existing repository seed IDs and their fictional contributors.
UPDATE `benchmark_runs` SET `is_synthetic` = 1
WHERE (`public_id` GLOB 'br_test_[0-9][0-9]' OR `public_id` IN ('br_test_hidden', 'br_test_deleted'))
AND `contributor_key` GLOB 'fictional-contributor-[0-2]-[0-1]';
