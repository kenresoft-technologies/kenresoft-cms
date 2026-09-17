CREATE TABLE `media_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`field_name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_attachments_owner_idx` ON `media_attachments` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_attachments_media_owner_field_idx` ON `media_attachments` (`media_id`,`owner_type`,`owner_id`,`field_name`);--> statement-breakpoint
ALTER TABLE `media` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
CREATE INDEX `media_visibility_idx` ON `media` (`visibility`);