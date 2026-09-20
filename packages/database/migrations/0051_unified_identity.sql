-- Unify Commerce customer identity into the core better-auth `user` system (docs/PLUGINS.md,
-- Commerce section). A storefront customer becomes a plain `user` row with role 'none' (no CMS
-- access) + a credential `account`; Commerce keeps only a small profile table keyed by user id.
-- Old Commerce sessions/tokens are dropped (customers simply sign in again).
--
-- The `user.role` column's DB-level DEFAULT is intentionally NOT changed here even though the
-- Drizzle schema now says 'none': SQLite can only change a default by rebuilding the table, and
-- dropping `user` would cascade-delete every session/account/two-factor row that references it.
-- The effective default comes from better-auth's additionalFields.defaultValue ('none',
-- apps/api/src/lib/auth-options.ts), which every user-creating path goes through.
--
-- Every rebuild below that drops a table with cascading children (carts, orders) first copies
-- those children to a scratch table and restores them afterwards, so the result is identical
-- whether or not the D1 runtime enforces foreign keys during a migration.

CREATE TABLE `plugin_commerce_customer_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`phone` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- 1. Every legacy customer whose email has no core user yet becomes a user with the SAME id, so
--    every existing cart/order/address reference stays valid without rewriting.
INSERT INTO `user` (`id`, `name`, `email`, `email_verified`, `created_at`, `updated_at`, `role`, `disabled`)
SELECT c.`id`, c.`name`, lower(c.`email`), c.`email_verified`, c.`created_at` * 1000, c.`updated_at` * 1000, 'none', c.`disabled`
FROM `plugin_commerce_customers` c
WHERE NOT EXISTS (SELECT 1 FROM `user` u WHERE lower(u.`email`) = lower(c.`email`));
--> statement-breakpoint
-- 2. Carry the existing password hash over as that user's credential account (same scrypt format
--    better-auth itself uses), so customers keep their current password.
INSERT INTO `account` (`id`, `account_id`, `provider_id`, `user_id`, `password`, `created_at`, `updated_at`)
SELECT 'commerce-legacy-' || c.`id`, c.`id`, 'credential', c.`id`, c.`password_hash`, c.`created_at` * 1000, c.`updated_at` * 1000
FROM `plugin_commerce_customers` c
WHERE EXISTS (SELECT 1 FROM `user` u WHERE u.`id` = c.`id` AND u.`role` = 'none')
  AND NOT EXISTS (SELECT 1 FROM `account` a WHERE a.`user_id` = c.`id`);
--> statement-breakpoint
-- 3. Commerce-specific data (phone) moves to the profile, keyed by the core user id (the
--    customer's own id, or — where the email already belonged to an existing user — that user's id).
INSERT OR IGNORE INTO `plugin_commerce_customer_profiles` (`user_id`, `phone`, `created_at`, `updated_at`)
SELECT u.`id`, c.`phone`, c.`created_at`, c.`updated_at`
FROM `plugin_commerce_customers` c
JOIN `user` u ON lower(u.`email`) = lower(c.`email`);
--> statement-breakpoint
-- 4. Repoint carts / addresses / orders at the core user id.
CREATE TABLE `__bak_cart_items` AS SELECT * FROM `plugin_commerce_cart_items`;
--> statement-breakpoint
CREATE TABLE `__new_plugin_commerce_carts` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`currency` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_plugin_commerce_carts`(`id`, `customer_id`, `currency`, `created_at`, `updated_at`)
SELECT o.`id`,
  (SELECT u.`id` FROM `plugin_commerce_customers` c JOIN `user` u ON lower(u.`email`) = lower(c.`email`) WHERE c.`id` = o.`customer_id`),
  o.`currency`, o.`created_at`, o.`updated_at`
FROM `plugin_commerce_carts` o;
--> statement-breakpoint
DROP TABLE `plugin_commerce_carts`;
--> statement-breakpoint
ALTER TABLE `__new_plugin_commerce_carts` RENAME TO `plugin_commerce_carts`;
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_commerce_carts_customer_id_unique_idx` ON `plugin_commerce_carts` (`customer_id`) WHERE "plugin_commerce_carts"."customer_id" is not null;
--> statement-breakpoint
DELETE FROM `plugin_commerce_cart_items`;
--> statement-breakpoint
INSERT INTO `plugin_commerce_cart_items` SELECT * FROM `__bak_cart_items`;
--> statement-breakpoint
DROP TABLE `__bak_cart_items`;
--> statement-breakpoint
CREATE TABLE `__new_plugin_commerce_customer_addresses` (
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
	FOREIGN KEY (`customer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_plugin_commerce_customer_addresses`(`id`, `customer_id`, `label`, `recipient_name`, `line1`, `line2`, `city`, `region`, `postal_code`, `country`, `phone`, `is_default`, `created_at`, `updated_at`)
SELECT o.`id`,
  (SELECT u.`id` FROM `plugin_commerce_customers` c JOIN `user` u ON lower(u.`email`) = lower(c.`email`) WHERE c.`id` = o.`customer_id`),
  o.`label`, o.`recipient_name`, o.`line1`, o.`line2`, o.`city`, o.`region`, o.`postal_code`, o.`country`, o.`phone`, o.`is_default`, o.`created_at`, o.`updated_at`
FROM `plugin_commerce_customer_addresses` o
WHERE EXISTS (SELECT 1 FROM `plugin_commerce_customers` c WHERE c.`id` = o.`customer_id`);
--> statement-breakpoint
DROP TABLE `plugin_commerce_customer_addresses`;
--> statement-breakpoint
ALTER TABLE `__new_plugin_commerce_customer_addresses` RENAME TO `plugin_commerce_customer_addresses`;
--> statement-breakpoint
CREATE INDEX `plugin_commerce_customer_addresses_customer_id_idx` ON `plugin_commerce_customer_addresses` (`customer_id`);
--> statement-breakpoint
CREATE TABLE `__bak_order_items` AS SELECT * FROM `plugin_commerce_order_items`;
--> statement-breakpoint
CREATE TABLE `__bak_order_payments` AS SELECT * FROM `plugin_commerce_order_payments`;
--> statement-breakpoint
CREATE TABLE `__new_plugin_commerce_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`customer_email` text NOT NULL,
	`customer_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`currency` text NOT NULL,
	`total_amount` integer NOT NULL,
	`shipping_address` text NOT NULL,
	`idempotency_key` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_plugin_commerce_orders`(`id`, `customer_id`, `customer_email`, `customer_name`, `status`, `currency`, `total_amount`, `shipping_address`, `idempotency_key`, `created_at`, `updated_at`)
SELECT o.`id`,
  (SELECT u.`id` FROM `plugin_commerce_customers` c JOIN `user` u ON lower(u.`email`) = lower(c.`email`) WHERE c.`id` = o.`customer_id`),
  o.`customer_email`, o.`customer_name`, o.`status`, o.`currency`, o.`total_amount`, o.`shipping_address`, o.`idempotency_key`, o.`created_at`, o.`updated_at`
FROM `plugin_commerce_orders` o;
--> statement-breakpoint
DROP TABLE `plugin_commerce_orders`;
--> statement-breakpoint
ALTER TABLE `__new_plugin_commerce_orders` RENAME TO `plugin_commerce_orders`;
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_commerce_orders_idempotency_key_unique` ON `plugin_commerce_orders` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `plugin_commerce_orders_customer_id_idx` ON `plugin_commerce_orders` (`customer_id`);
--> statement-breakpoint
CREATE INDEX `plugin_commerce_orders_status_idx` ON `plugin_commerce_orders` (`status`);
--> statement-breakpoint
DELETE FROM `plugin_commerce_order_items`;
--> statement-breakpoint
INSERT INTO `plugin_commerce_order_items` SELECT * FROM `__bak_order_items`;
--> statement-breakpoint
DROP TABLE `__bak_order_items`;
--> statement-breakpoint
DELETE FROM `plugin_commerce_order_payments`;
--> statement-breakpoint
INSERT INTO `plugin_commerce_order_payments` SELECT * FROM `__bak_order_payments`;
--> statement-breakpoint
DROP TABLE `__bak_order_payments`;
--> statement-breakpoint
-- 5. The duplicate identity/session/token structures are now redundant.
DROP TABLE `plugin_commerce_customer_sessions`;
--> statement-breakpoint
DROP TABLE `plugin_commerce_customer_tokens`;
--> statement-breakpoint
DROP TABLE `plugin_commerce_customers`;
