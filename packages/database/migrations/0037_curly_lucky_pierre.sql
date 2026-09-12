CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`route` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`publish_at` integer,
	`blocks` text NOT NULL,
	`seo` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_route_unique` ON `pages` (`route`);--> statement-breakpoint
CREATE INDEX `pages_status_publish_at_idx` ON `pages` (`status`,`publish_at`);--> statement-breakpoint
CREATE TABLE `page_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`blocks` text NOT NULL,
	`seo` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `page_revisions_page_id_idx` ON `page_revisions` (`page_id`);