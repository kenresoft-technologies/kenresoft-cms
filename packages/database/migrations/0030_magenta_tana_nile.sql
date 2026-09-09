ALTER TABLE `plugin_commerce_orders` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_commerce_orders_idempotency_key_unique` ON `plugin_commerce_orders` (`idempotency_key`);--> statement-breakpoint
-- Before enforcing "at most one open payment attempt per order" as a real, DB-level constraint
-- below, resolve any pre-existing violations of it: the code shipped before this migration built
-- claimPendingPaymentAttempt's reservation as a plain check-then-insert, a genuine TOCTOU race
-- that could leave more than one 'pending' row for the same order on any database this migration
-- runs against (an install that already deployed that code, however briefly). Without this step,
-- the CREATE UNIQUE INDEX below would fail outright on any such database, since a unique index
-- cannot be created over data that already violates it. Keep only the most recently created
-- pending attempt per order; mark any older duplicates 'failed' — the ledger row itself is kept
-- (this table exists specifically to record every attempt, not just successful ones), just marked
-- as no longer open, exactly what a real claim conflict would have produced under the fixed code.
UPDATE `plugin_commerce_order_payments`
SET `status` = 'failed', `resolved_at` = unixepoch()
WHERE `status` = 'pending'
  AND `id` NOT IN (
    SELECT `id` FROM (
      SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `order_id` ORDER BY `created_at` DESC, `id` DESC) AS `rn`
      FROM `plugin_commerce_order_payments`
      WHERE `status` = 'pending'
    )
    WHERE `rn` = 1
  );--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_commerce_order_payments_one_pending_per_order_idx` ON `plugin_commerce_order_payments` (`order_id`) WHERE "plugin_commerce_order_payments"."status" = 'pending';