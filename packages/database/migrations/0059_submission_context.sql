ALTER TABLE `forms` ADD `context_config` text;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `context_entry_id` text REFERENCES entries(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `context` text;