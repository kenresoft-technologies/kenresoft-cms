ALTER TABLE `entries` ADD `featured` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `entries_content_type_featured_idx` ON `entries` (`content_type_id`,`featured`);