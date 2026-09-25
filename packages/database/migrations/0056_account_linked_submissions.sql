CREATE TABLE `form_submission_stage_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`stage` text NOT NULL,
	`changed_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `form_submission_stage_changes_submission_id_idx` ON `form_submission_stage_changes` (`submission_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_form_submission_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`author_user_id` text,
	`direction` text DEFAULT 'outbound' NOT NULL,
	`to` text,
	`subject` text,
	`body_html` text NOT NULL,
	`attachments` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_form_submission_replies`("id", "submission_id", "author_user_id", "direction", "to", "subject", "body_html", "attachments", "created_at") SELECT "id", "submission_id", "author_user_id", 'outbound', "to", "subject", "body_html", "attachments", "created_at" FROM `form_submission_replies`;--> statement-breakpoint
DROP TABLE `form_submission_replies`;--> statement-breakpoint
ALTER TABLE `__new_form_submission_replies` RENAME TO `form_submission_replies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `form_submission_replies_submission_id_idx` ON `form_submission_replies` (`submission_id`);--> statement-breakpoint
ALTER TABLE `forms` ADD `requires_account` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `forms` ADD `stages` text;--> statement-breakpoint
ALTER TABLE `forms` ADD `account_submission_url` text;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `account_user_id` text REFERENCES user(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `stage` text;--> statement-breakpoint
CREATE INDEX `form_submissions_account_user_id_idx` ON `form_submissions` (`account_user_id`);