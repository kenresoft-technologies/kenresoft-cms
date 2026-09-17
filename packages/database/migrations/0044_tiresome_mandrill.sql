CREATE TABLE `entry_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`content_type_id` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`content_type_id`) REFERENCES `content_types`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `entry_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `entry_folders_content_type_id_idx` ON `entry_folders` (`content_type_id`);--> statement-breakpoint
CREATE INDEX `entry_folders_parent_id_idx` ON `entry_folders` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entry_folders_content_type_parent_name_idx` ON `entry_folders` (`content_type_id`,`parent_id`,`name`);--> statement-breakpoint
ALTER TABLE `entries` ADD `folder_id` text REFERENCES entry_folders(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `entries_folder_id_idx` ON `entries` (`folder_id`);--> statement-breakpoint
ALTER TABLE `media_folders` ADD `parent_id` text REFERENCES media_folders(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `media_folders_parent_id_idx` ON `media_folders` (`parent_id`);