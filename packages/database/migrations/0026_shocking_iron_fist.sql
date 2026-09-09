CREATE TABLE `plugin_commerce_cart_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `plugin_commerce_carts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `plugin_commerce_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `plugin_commerce_product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plugin_commerce_cart_items_cart_id_idx` ON `plugin_commerce_cart_items` (`cart_id`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_cart_items_product_id_idx` ON `plugin_commerce_cart_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_cart_items_variant_id_idx` ON `plugin_commerce_cart_items` (`variant_id`);--> statement-breakpoint
CREATE TABLE `plugin_commerce_carts` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`currency` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `plugin_commerce_customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_commerce_carts_customer_id_unique_idx` ON `plugin_commerce_carts` (`customer_id`) WHERE "plugin_commerce_carts"."customer_id" is not null;--> statement-breakpoint
CREATE TABLE `plugin_commerce_customer_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`label` text,
	`recipient_name` text NOT NULL,
	`line1` text NOT NULL,
	`line2` text,
	`city` text NOT NULL,
	`region` text,
	`postal_code` text NOT NULL,
	`country` text NOT NULL,
	`phone` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `plugin_commerce_customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plugin_commerce_customer_addresses_customer_id_idx` ON `plugin_commerce_customer_addresses` (`customer_id`);--> statement-breakpoint
CREATE TABLE `plugin_commerce_customer_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `plugin_commerce_customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_commerce_customer_sessions_token_hash_unique` ON `plugin_commerce_customer_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_customer_sessions_customer_id_idx` ON `plugin_commerce_customer_sessions` (`customer_id`);--> statement-breakpoint
CREATE TABLE `plugin_commerce_customer_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `plugin_commerce_customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_commerce_customer_tokens_token_hash_unique` ON `plugin_commerce_customer_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_customer_tokens_customer_id_idx` ON `plugin_commerce_customer_tokens` (`customer_id`);--> statement-breakpoint
CREATE TABLE `plugin_commerce_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_commerce_customers_email_unique` ON `plugin_commerce_customers` (`email`);