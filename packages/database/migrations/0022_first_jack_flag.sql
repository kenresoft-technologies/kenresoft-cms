CREATE TABLE `plugin_settings` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`config_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plugin_hello_greetings` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plugin_hello_greetings_created_at_idx` ON `plugin_hello_greetings` (`created_at`);