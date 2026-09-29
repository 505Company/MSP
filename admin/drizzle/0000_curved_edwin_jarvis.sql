CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`details_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_entity` ON `audit_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `upload_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`progress` integer NOT NULL,
	`slide_count` integer,
	`object_count` integer,
	`color_count` integer,
	`typography_count` integer,
	`warning_count` integer,
	`qwen_status` text NOT NULL,
	`source_object_key` text,
	`profile_object_key` text,
	`analysis_object_key` text,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_upload_jobs_updated_at` ON `upload_jobs` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_upload_jobs_status_updated_at` ON `upload_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_upload_jobs_batch_id` ON `upload_jobs` (`batch_id`);