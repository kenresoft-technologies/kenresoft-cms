CREATE TABLE `plugin_commerce_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`variant_id` text,
	`product_name` text NOT NULL,
	`variant_name` text,
	`sku` text,
	`unit_price_at_purchase` integer NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `plugin_commerce_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `plugin_commerce_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`variant_id`) REFERENCES `plugin_commerce_product_variants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plugin_commerce_order_items_order_id_idx` ON `plugin_commerce_order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_order_items_product_id_idx` ON `plugin_commerce_order_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_order_items_variant_id_idx` ON `plugin_commerce_order_items` (`variant_id`);--> statement-breakpoint
CREATE TABLE `plugin_commerce_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`customer_email` text NOT NULL,
	`customer_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`currency` text NOT NULL,
	`total_amount` integer NOT NULL,
	`shipping_address` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `plugin_commerce_customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plugin_commerce_orders_customer_id_idx` ON `plugin_commerce_orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_orders_status_idx` ON `plugin_commerce_orders` (`status`);