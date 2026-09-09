CREATE TABLE `plugin_enablement` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
