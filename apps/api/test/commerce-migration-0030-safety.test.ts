import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Migration 0030 adds `plugin_commerce_order_payments_one_pending_per_order_idx`, a real UNIQUE
// index enforcing "at most one open ('pending') payment attempt per order." The code that shipped
// BEFORE this migration (claimPendingPaymentAttempt as a plain check-then-insert) had a genuine
// TOCTOU race that could leave more than one 'pending' row for the same order on any database that
// already ran that code — meaning a straight `CREATE UNIQUE INDEX` would fail outright on such a
// database, since SQLite refuses to create a unique index over data that already violates it. This
// test proves the migration's own defensive cleanup step (a real UPDATE, embedded verbatim from
// packages/database/migrations/0030_magenta_tana_nile.sql) actually resolves that violation before
// the index is created, rather than trusting the SQL by inspection alone (issue 3 of the payments
// concurrency review).
//
// The index already exists in this test database (every migration runs before the suite starts) —
// this test drops it, deliberately reproduces the pre-migration "two pending rows for one order"
// violation the cleanup step exists to fix, re-runs that exact cleanup SQL, then recreates the
// index to prove it now succeeds. The index is always restored in a `finally`, so a failure here
// can't leave the shared test database's schema permanently altered for every test that runs after.
//
// Uses plain try/catch around the expected-to-reject `env.DB.exec()` calls, not vitest's
// `expect(...).rejects` — empirically, in this D1 test runtime, `.rejects` can miss the rejection
// (it surfaces later as an unrelated failure at the next unconnected `await`) where a direct
// try/catch reliably observes it.
const DROP_INDEX_SQL = `DROP INDEX IF EXISTS plugin_commerce_order_payments_one_pending_per_order_idx`;
const CREATE_INDEX_SQL = `CREATE UNIQUE INDEX plugin_commerce_order_payments_one_pending_per_order_idx ON plugin_commerce_order_payments (order_id) WHERE plugin_commerce_order_payments.status = 'pending'`;
// Verbatim (modulo whitespace) from packages/database/migrations/0030_magenta_tana_nile.sql — kept
// as a literal copy, not an import, since a real migration file is plain SQL, not a reusable
// module. Deliberately collapsed onto ONE line: `D1Database.exec()` (unlike `.prepare()`/`.batch()`)
// splits its input on newlines and executes each line as its own statement — a real gotcha found
// while writing this test, not present in the actual migration path (drizzle's own migration
// runner applies each `--> statement-breakpoint`-separated block as a single prepared statement,
// not via `.exec()`, so the multi-line formatting in the real migration file is unaffected).
const CLEANUP_SQL = `UPDATE plugin_commerce_order_payments SET status = 'failed', resolved_at = unixepoch() WHERE status = 'pending' AND id NOT IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at DESC, id DESC) AS rn FROM plugin_commerce_order_payments WHERE status = 'pending') WHERE rn = 1)`;

async function createIndexExpectingFailure(): Promise<boolean> {
  try {
    await env.DB.exec(CREATE_INDEX_SQL);
    return false;
  } catch {
    return true;
  }
}

async function freshAdminCookie(): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'commerce-migration-safety-admin@example.test', password: 'correct horse battery staple', name: 'Admin' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

async function createPendingOrder(adminCookie: string): Promise<string> {
  const productRes = await SELF.fetch('https://example.com/api/plugins/commerce/v1/products', {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Widget', slug: `widget-${crypto.randomUUID()}`, basePrice: 5000, currency: 'NGN', status: 'published' }),
  });
  const product = await productRes.json<{ id: string }>();

  const addRes = await SELF.fetch('https://example.com/api/plugins/commerce/public/v1/cart/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: product.id, quantity: 1 }),
  });
  const setCookie = addRes.headers.get('set-cookie');
  const guestCartCookie = setCookie
    ?.split(',')
    .find((part) => part.trim().startsWith('commerce_guest_cart='))
    ?.trim()
    .split(';')[0];
  if (!guestCartCookie) throw new Error('add-to-cart did not return a guest cart cookie');

  const res = await SELF.fetch('https://example.com/api/plugins/commerce/public/v1/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), Cookie: guestCartCookie },
    body: JSON.stringify({
      email: 'buyer@example.test',
      name: 'Buyer',
      shippingAddress: { recipientName: 'Buyer', line1: '1 Main St', city: 'Lagos', postalCode: '100001', country: 'NG' },
    }),
  });
  expect(res.status).toBe(201);
  const order = await res.json<{ id: string }>();
  return order.id;
}

describe('migration 0030: one-pending-payment-per-order index is safe against pre-existing duplicate data (real D1)', () => {
  it('the cleanup step resolves duplicate pending rows so the unique index can be (re)created', async () => {
    const adminCookie = await freshAdminCookie();
    const orderId = await createPendingOrder(adminCookie);

    await env.DB.exec(DROP_INDEX_SQL);
    try {
      // Reproduce the pre-fix violation this cleanup step exists for: two 'pending' rows for the
      // same order, exactly what the old check-then-insert race could produce. Only possible at
      // all with the index dropped.
      const olderReference = crypto.randomUUID();
      const newerReference = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `INSERT INTO plugin_commerce_order_payments (id, order_id, provider, reference, status, created_at) VALUES (?, ?, 'paystack', ?, 'pending', ?)`,
      )
        .bind(crypto.randomUUID(), orderId, olderReference, now - 60)
        .run();
      await env.DB.prepare(
        `INSERT INTO plugin_commerce_order_payments (id, order_id, provider, reference, status, created_at) VALUES (?, ?, 'paystack', ?, 'pending', ?)`,
      )
        .bind(crypto.randomUUID(), orderId, newerReference, now)
        .run();

      const beforeCleanup = await env.DB.prepare(`SELECT COUNT(*) as count FROM plugin_commerce_order_payments WHERE order_id = ? AND status = 'pending'`)
        .bind(orderId)
        .first<{ count: number }>();
      expect(beforeCleanup?.count).toBe(2);

      // Creating the index now, against dirty data, is exactly what would fail on a real
      // pre-migration database without the cleanup step first — proves the violation is real.
      expect(await createIndexExpectingFailure()).toBe(true);

      await env.DB.exec(CLEANUP_SQL);

      const olderRow = await env.DB.prepare('SELECT status, resolved_at FROM plugin_commerce_order_payments WHERE reference = ?')
        .bind(olderReference)
        .first<{ status: string; resolved_at: number | null }>();
      expect(olderRow?.status).toBe('failed');
      expect(olderRow?.resolved_at).not.toBeNull();

      const newerRow = await env.DB.prepare('SELECT status FROM plugin_commerce_order_payments WHERE reference = ?')
        .bind(newerReference)
        .first<{ status: string }>();
      expect(newerRow?.status).toBe('pending');

      // The actual assertion: the index can now be created without error.
      await env.DB.exec(CREATE_INDEX_SQL);
      const rowsAfter = await env.DB.prepare(`SELECT COUNT(*) as count FROM plugin_commerce_order_payments WHERE order_id = ? AND status = 'pending'`)
        .bind(orderId)
        .first<{ count: number }>();
      expect(rowsAfter?.count).toBe(1);
    } finally {
      // Always leave the shared test database's schema exactly as every other test expects it,
      // regardless of whether the assertions above passed.
      await env.DB.exec(DROP_INDEX_SQL);
      await env.DB.exec(CREATE_INDEX_SQL);
    }
  });
});
