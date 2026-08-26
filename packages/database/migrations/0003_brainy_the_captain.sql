CREATE TABLE `entry_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`data` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `entry_revisions_entry_id_idx` ON `entry_revisions` (`entry_id`);--> statement-breakpoint
ALTER TABLE `entries` ADD `publish_at` integer;--> statement-breakpoint
CREATE INDEX `entries_status_publish_at_idx` ON `entries` (`status`,`publish_at`);