CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`subject` text NOT NULL,
	`body_html` text NOT NULL,
	`plain_text` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_templates_key_unique` ON `email_templates` (`key`);