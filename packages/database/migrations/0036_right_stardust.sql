ALTER TABLE `content_types` ADD `route_pattern` text;--> statement-breakpoint
CREATE UNIQUE INDEX `content_types_route_pattern_unique` ON `content_types` (`route_pattern`);