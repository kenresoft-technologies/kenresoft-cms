ALTER TABLE `forms` ADD `unique_fields` text;--> statement-breakpoint
ALTER TABLE `forms` ADD `requires_human_check` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `dedupe_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `form_submissions_form_dedupe_key_idx` ON `form_submissions` (`form_id`,`dedupe_key`);