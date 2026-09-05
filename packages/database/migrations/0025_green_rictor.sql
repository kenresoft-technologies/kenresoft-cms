CREATE TABLE `plugin_commerce_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`parent_id` text,
	`image_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `plugin_commerce_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plugin_commerce_categories_slug_idx` ON `plugin_commerce_categories` (`slug`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_categories_parent_id_idx` ON `plugin_commerce_categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `plugin_commerce_product_images` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`media_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`alt_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `plugin_commerce_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plugin_commerce_product_images_product_id_idx` ON `plugin_commerce_product_images` (`product_id`);--> statement-breakpoint
CREATE TABLE `plugin_commerce_product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`sku` text,
	`price` integer,
	`compare_at_price` integer,
	`stock_qty` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`attributes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `plugin_commerce_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plugin_commerce_product_variants_product_id_idx` ON `plugin_commerce_product_variants` (`product_id`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_product_variants_sku_idx` ON `plugin_commerce_product_variants` (`sku`);--> statement-breakpoint
CREATE TABLE `plugin_commerce_products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`short_description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`product_type` text DEFAULT 'physical' NOT NULL,
	`base_price` integer NOT NULL,
	`currency` text NOT NULL,
	`sku` text,
	`category_id` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `plugin_commerce_categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plugin_commerce_products_slug_idx` ON `plugin_commerce_products` (`slug`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_products_category_id_idx` ON `plugin_commerce_products` (`category_id`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_products_status_idx` ON `plugin_commerce_products` (`status`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_products_sku_idx` ON `plugin_commerce_products` (`sku`);