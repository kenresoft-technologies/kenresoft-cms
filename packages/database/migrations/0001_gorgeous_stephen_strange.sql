CREATE TABLE `content_types` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_types_project_slug_unique` ON `content_types` (`project_id`,`slug`);--> statement-breakpoint
CREATE TABLE `field_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`content_type_id` text NOT NULL,
	`name` text NOT NULL,
	`label` text NOT NULL,
	`field_type` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`config` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`content_type_id`) REFERENCES `content_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_definitions_content_type_name_unique` ON `field_definitions` (`content_type_id`,`name`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`content_type_id` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_type_id`) REFERENCES `content_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_content_type_slug_unique` ON `entries` (`content_type_id`,`slug`);--> statement-breakpoint
CREATE INDEX `entries_project_status_idx` ON `entries` (`project_id`,`status`);