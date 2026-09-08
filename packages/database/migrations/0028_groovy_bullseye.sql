CREATE TABLE `plugin_commerce_idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`response_status` integer,
	`response_body` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plugin_commerce_order_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider` text DEFAULT 'paystack' NOT NULL,
	`reference` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`amount` integer,
	`currency` text,
	`raw_payload` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `plugin_commerce_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_commerce_order_payments_reference_unique` ON `plugin_commerce_order_payments` (`reference`);--> statement-breakpoint
CREATE INDEX `plugin_commerce_order_payments_order_id_idx` ON `plugin_commerce_order_payments` (`order_id`);