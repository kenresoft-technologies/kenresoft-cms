CREATE TABLE `structured_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `structured_settings_module_unique` ON `structured_settings` (`module`);