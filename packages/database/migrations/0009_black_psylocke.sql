ALTER TABLE `entries` ADD `created_by` text REFERENCES user(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
UPDATE `entries` SET `created_by` = (SELECT `entry_revisions`.`created_by` FROM `entry_revisions` WHERE `entry_revisions`.`entry_id` = `entries`.`id` ORDER BY `entry_revisions`.`created_at` ASC LIMIT 1) WHERE `created_by` IS NULL;
