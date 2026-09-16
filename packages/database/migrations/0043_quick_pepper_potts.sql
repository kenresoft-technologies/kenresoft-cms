CREATE TABLE `installation_bootstrap` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_folders_slug_idx` ON `media_folders` (`slug`);--> statement-breakpoint
CREATE TABLE `ui_content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`ui_content_type_id` text NOT NULL,
	`slug` text NOT NULL,
	`data` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`ui_content_type_id`) REFERENCES `ui_content_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ui_content_items_type_slug_idx` ON `ui_content_items` (`ui_content_type_id`,`slug`);--> statement-breakpoint
CREATE INDEX `ui_content_items_type_id_idx` ON `ui_content_items` (`ui_content_type_id`);--> statement-breakpoint
CREATE TABLE `ui_content_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`fields` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ui_content_types_slug_idx` ON `ui_content_types` (`slug`);--> statement-breakpoint
ALTER TABLE `media` ADD `folder_id` text REFERENCES media_folders(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `media_folder_id_idx` ON `media` (`folder_id`);--> statement-breakpoint
ALTER TABLE `webhooks` ADD `allow_private_destinations` integer DEFAULT false NOT NULL;