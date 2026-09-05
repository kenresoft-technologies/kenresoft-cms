INSERT INTO `global_variables` (`id`, `key`, `value`)
SELECT lower(hex(randomblob(16))), 'contact_email', `s`.`contact_email`
FROM `settings` `s`
WHERE `s`.`contact_email` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `global_variables` WHERE `key` = 'contact_email');--> statement-breakpoint
INSERT INTO `global_variables` (`id`, `key`, `value`)
SELECT lower(hex(randomblob(16))), 'social_' || `je`.`key`, `je`.`value`
FROM `settings` `s`, json_each(`s`.`social_links`) `je`
WHERE `s`.`social_links` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `global_variables` WHERE `key` = 'social_' || `je`.`key`);--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `contact_email`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `social_links`;
