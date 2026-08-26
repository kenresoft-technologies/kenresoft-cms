CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact_email` text,
	`social_links` text,
	`cors_origin` text,
	`feature_flags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
