CREATE TABLE `cache_purge_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`paths` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`last_attempt_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cache_purge_jobs_status_created_at_idx` ON `cache_purge_jobs` (`status`,`created_at`);