CREATE TABLE `__new_content_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_content_types`("id", "name", "slug", "description", "created_at", "updated_at") SELECT "id", "name", "slug", "description", "created_at", "updated_at" FROM `content_types`;--> statement-breakpoint
DROP TABLE `content_types`;--> statement-breakpoint
ALTER TABLE `__new_content_types` RENAME TO `content_types`;--> statement-breakpoint
CREATE UNIQUE INDEX `content_types_slug_unique` ON `content_types` (`slug`);--> statement-breakpoint
CREATE TABLE `__new_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`content_type_id` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`publish_at` integer,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`content_type_id`) REFERENCES `content_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_entries`("id", "content_type_id", "slug", "status", "publish_at", "data", "created_at", "updated_at") SELECT "id", "content_type_id", "slug", "status", "publish_at", "data", "created_at", "updated_at" FROM `entries`;--> statement-breakpoint
DROP TABLE `entries`;--> statement-breakpoint
ALTER TABLE `__new_entries` RENAME TO `entries`;--> statement-breakpoint
CREATE UNIQUE INDEX `entries_content_type_slug_unique` ON `entries` (`content_type_id`,`slug`);--> statement-breakpoint
CREATE INDEX `entries_status_publish_at_idx` ON `entries` (`status`,`publish_at`);--> statement-breakpoint
DROP TABLE `projects`;
