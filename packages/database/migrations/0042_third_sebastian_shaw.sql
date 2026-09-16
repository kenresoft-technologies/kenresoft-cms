CREATE TABLE `form_submission_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`author_user_id` text,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`body_html` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `form_submission_replies_submission_id_idx` ON `form_submission_replies` (`submission_id`);