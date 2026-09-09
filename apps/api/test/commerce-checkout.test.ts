import { createDb } from '@kenresoft-cms/database';
import { listItemsWithDetail } from '@kenresoft-cms/plugin-ecommerce/src/repository/cart-items';
import { getGuestCart } from '@kenresoft-cms/plugin-ecommerce/src/repository/carts';
import { createCustomerSession } from '@kenresoft-cms/plugin-ecommerce/src/repository/customer-sessions';
import { createCustomer } from '@kenresoft-cms/plugin-ecommerce/src/repository/customers';
import { createOrder } from '@kenresoft-cms/plugin-ecommerce/src/repository/orders';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const ADMIN_BASE = 'https://example.com/api/plugins/commerce/v1';
const CART_BASE = 'https://example.com/api/plugins/commerce/public/v1/cart';
const CHECKOUT_BASE = 'https://example.com/api/plugins/commerce/public/v1/checkout';

const SHIPPING_ADDRESS = {
  recipientName: 'Jane Doe',
  line1: '1 Market Street',
  city: 'Lagos',
  postalCode: '100001',
  country: 'NG',
};

function extractGuestCartCookie(response: Response): string | undefined {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return undefined;
  const match = setCookie.split(',').find((part) => part.trim().startsWith('commerce_guest_cart='));
  return match?.trim().split(';')[0];
}

async function freshAdminCookie(): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'commerce-checkout-admin@example.test', password: 'correct horse battery staple', name: 'Admin' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

async function createPublishedProduct(adminCookie: string, overrides: Record<string, unknown> = {}) {
  const response = await SELF.fetch(`${ADMIN_BASE}/products`, {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Widget',
      slug: `widget-${crypto.randomUUID()}`,
      basePrice: 1000,
      currency: 'NGN',
      status: 'published',
      ...overrides,
    }),
  });
  return response.json<{ id: string; currency: string }>();
}

async function createVariant(adminCookie: string, productId: string, overrides: Record<string, unknown> = {}) {
  const response = await SELF.fetch(`${ADMIN_BASE}/products/${productId}/variants`, {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Small', stockQty: 5, ...overrides }),
  });
  return response.json<{ id: string; stockQty: number }>();
}

async function addToGuestCart(productId: string, variantId?: string, quantity = 1) {
  const res = await SELF.fetch(`${CART_BASE}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, variantId, quantity }),
  });
  return { res, cookie: extractGuestCartCookie(res) };
}

async function registeredCustomer(email: string) {
  const db = createDb(env.DB);
  const customer = await createCustomer(db, { email, name: 'Test Customer', password: 'correct horse battery staple' });
  const rawToken = await createCustomerSession(db, customer.id);
  return { customer, cookie: `commerce_customer_session=${rawToken}` };
}

describe('commerce plugin: checkout (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_order_items');
    await env.DB.exec('DELETE FROM plugin_commerce_orders');
    await env.DB.exec('DELETE FROM plugin_commerce_idempotency_keys');
    await env.DB.exec('DELETE FROM plugin_commerce_cart_items');
    await env.DB.exec('DELETE FROM plugin_commerce_carts');
    await env.DB.exec('DELETE FROM plugin_commerce_customer_sessions');
    await env.DB.exec('DELETE FROM plugin_commerce_customers');
    await env.DB.exec('DELETE FROM plugin_commerce_product_variants');
    await env.DB.exec('DELETE FROM plugin_commerce_product_images');
    await env.DB.exec('DELETE FROM plugin_commerce_products');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('rejects checking out an empty cart', async () => {
    const res = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ email: 'nobody@example.test', name: 'Nobody', shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects checkout with no Idempotency-Key header', async () => {
    const res = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.test', name: 'Nobody', shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a guest checkout with no email/name', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const { cookie } = await addToGuestCart(product.id);

    const res = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(res.status).toBe(400);
  });

  it('a guest checkout creates an order, decrements tracked stock, and clears the cart', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const variant = await createVariant(adminCookie, product.id, { stockQty: 5, price: 1500 });
    const { cookie } = await addToGuestCart(product.id, variant.id, 2);

    const res = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ email: 'guest@example.test', name: 'Guest Buyer', shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(res.status).toBe(201);
    const order = await res.json<{ id: string; status: string; totalAmount: number; customerEmail: string; items: Array<{ quantity: number; unitPriceAtPurchase: number }> }>();
    expect(order.status).toBe('pending');
    expect(order.customerEmail).toBe('guest@example.test');
    expect(order.totalAmount).toBe(3000);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ quantity: 2, unitPriceAtPurchase: 1500 });

    const stockRow = await env.DB.prepare('SELECT stock_qty FROM plugin_commerce_product_variants WHERE id = ?')
      .bind(variant.id)
      .first<{ stock_qty: number }>();
    expect(stockRow?.stock_qty).toBe(3);

    const cartAfter = await SELF.fetch(CART_BASE, { headers: { Cookie: cookie! } });
    expect(await cartAfter.json()).toEqual({ id: null, currency: null, items: [] });
  });

  it('a customer checkout defaults email/name from the profile and links customerId', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const { customer, cookie } = await registeredCustomer('checkout-customer@example.test');
    await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, quantity: 1 }),
    });

    const res = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(res.status).toBe(201);
    const order = await res.json<{ customerEmail: string; customerName: string }>();
    expect(order.customerEmail).toBe('checkout-customer@example.test');
    expect(order.customerName).toBe('Test Customer');

    const row = await env.DB.prepare('SELECT customer_id FROM plugin_commerce_orders WHERE customer_email = ?')
      .bind('checkout-customer@example.test')
      .first<{ customer_id: string }>();
    expect(row?.customer_id).toBe(customer.id);
  });

  it('rejects checkout when an item is no longer available (unpublished after being added to cart)', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const { cookie } = await addToGuestCart(product.id);

    await SELF.fetch(`${ADMIN_BASE}/products/${product.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'draft' }),
    });

    const res = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ email: 'guest@example.test', name: 'Guest Buyer', shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(res.status).toBe(400);

    const orderCount = await env.DB.prepare('SELECT COUNT(*) as count FROM plugin_commerce_orders').first<{ count: number }>();
    expect(orderCount?.count).toBe(0);
  });

  it('rejects checkout when stock dropped below the cart quantity in the meantime, and restores no stock change', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const variant = await createVariant(adminCookie, product.id, { stockQty: 5 });
    const { cookie } = await addToGuestCart(product.id, variant.id, 3);

    // Simulate another order depleting stock between add-to-cart and this checkout.
    await env.DB.prepare('UPDATE plugin_commerce_product_variants SET stock_qty = 1 WHERE id = ?').bind(variant.id).run();

    const res = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ email: 'guest@example.test', name: 'Guest Buyer', shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(res.status).toBe(400);

    const stockRow = await env.DB.prepare('SELECT stock_qty FROM plugin_commerce_product_variants WHERE id = ?')
      .bind(variant.id)
      .first<{ stock_qty: number }>();
    expect(stockRow?.stock_qty).toBe(1);

    const orderCount = await env.DB.prepare('SELECT COUNT(*) as count FROM plugin_commerce_orders').first<{ count: number }>();
    expect(orderCount?.count).toBe(0);
  });

  it('a failed multi-item checkout gives back stock reserved from the items that DID have enough', async () => {
    const adminCookie = await freshAdminCookie();
    const productA = await createPublishedProduct(adminCookie);
    const variantA = await createVariant(adminCookie, productA.id, { stockQty: 5 });
    const productB = await createPublishedProduct(adminCookie);
    const variantB = await createVariant(adminCookie, productB.id, { stockQty: 1 });

    const { cookie } = await addToGuestCart(productA.id, variantA.id, 2);
    await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: productB.id, variantId: variantB.id, quantity: 1 }),
    });

    // Deplete B's stock right before checkout, so A would succeed but B would not.
    await env.DB.prepare('UPDATE plugin_commerce_product_variants SET stock_qty = 0 WHERE id = ?').bind(variantB.id).run();

    const res = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ email: 'guest@example.test', name: 'Guest Buyer', shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(res.status).toBe(400);

    const stockA = await env.DB.prepare('SELECT stock_qty FROM plugin_commerce_product_variants WHERE id = ?')
      .bind(variantA.id)
      .first<{ stock_qty: number }>();
    // A's stock was reserved (decremented) then given back when B failed — must be exactly what
    // it was before this checkout attempt, not silently short by 2.
    expect(stockA?.stock_qty).toBe(5);
  });

  it('two concurrent checkouts for the last unit of stock: exactly one succeeds', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const variant = await createVariant(adminCookie, product.id, { stockQty: 1 });

    const { customer: buyerA, cookie: cookieA } = await registeredCustomer('race-buyer-a@example.test');
    const { customer: buyerB, cookie: cookieB } = await registeredCustomer('race-buyer-b@example.test');
    void buyerA;
    void buyerB;

    await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, variantId: variant.id, quantity: 1 }),
    });
    await SELF.fetch(`${CART_BASE}/items`, {
      method: 'POST',
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, variantId: variant.id, quantity: 1 }),
    });

    const [resA, resB] = await Promise.all([
      SELF.fetch(CHECKOUT_BASE, {
        method: 'POST',
        headers: { Cookie: cookieA, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ shippingAddress: SHIPPING_ADDRESS }),
      }),
      SELF.fetch(CHECKOUT_BASE, {
        method: 'POST',
        headers: { Cookie: cookieB, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ shippingAddress: SHIPPING_ADDRESS }),
      }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 400]);

    const stockRow = await env.DB.prepare('SELECT stock_qty FROM plugin_commerce_product_variants WHERE id = ?')
      .bind(variant.id)
      .first<{ stock_qty: number }>();
    expect(stockRow?.stock_qty).toBe(0);

    const orderCount = await env.DB.prepare('SELECT COUNT(*) as count FROM plugin_commerce_orders').first<{ count: number }>();
    expect(orderCount?.count).toBe(1);
  });

  it('a retried checkout with the same Idempotency-Key returns the same order instead of creating a second one', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const { cookie } = await addToGuestCart(product.id);
    const idempotencyKey = crypto.randomUUID();

    const first = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ email: 'guest@example.test', name: 'Guest Buyer', shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(first.status).toBe(201);
    const firstOrder = await first.json<{ id: string }>();

    // The cart is already gone after the first success — a naive retry with a fresh key would
    // 400 "cart is empty" here, which is exactly why this test reuses the SAME key: a real client
    // retry (e.g. after a lost response) resends the identical key, not a new one.
    const second = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ email: 'guest@example.test', name: 'Guest Buyer', shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(second.status).toBe(201);
    const secondOrder = await second.json<{ id: string }>();
    expect(secondOrder.id).toBe(firstOrder.id);

    const orderCount = await env.DB.prepare('SELECT COUNT(*) as count FROM plugin_commerce_orders').first<{ count: number }>();
    expect(orderCount?.count).toBe(1);
  });

  it('two concurrent checkouts with the same Idempotency-Key produce exactly one order between them', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const { cookie } = await addToGuestCart(product.id);
    const idempotencyKey = crypto.randomUUID();

    const requestInit = {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ email: 'guest@example.test', name: 'Guest Buyer', shippingAddress: SHIPPING_ADDRESS }),
    };
    const [resA, resB] = await Promise.all([SELF.fetch(CHECKOUT_BASE, requestInit), SELF.fetch(CHECKOUT_BASE, requestInit)]);
    let statuses = [resA.status, resB.status];

    // Whichever request loses the claim race either replays the winner's cached 201 or, if it
    // arrived before the winner had finished, gets a 409 asking it to retry shortly — both are
    // acceptable outcomes of "never double-process," unlike a second, distinct order existing.
    // Checked via `includes`/`every`, NOT `.sort()` position: `[status, status].sort()` sorts as
    // STRINGS by default (no comparator), and "409" always sorts after "201" lexically — so a
    // naive `expect(statuses[1]).toBe(201)` after a bare `.sort()` can NEVER pass whenever either
    // response is genuinely 409, even though this comment already documented that outcome as
    // acceptable. That was a real, latent bug in this assertion itself (not a product bug):
    // confirmed by adding temporary debug logging around a "both literally 409" branch on CI,
    // which never fired — proving the actual pair was the ordinary, documented-fine [201, 409]
    // the old sort-based comparison simply couldn't express, not a genuine double-409 race.
    if (!statuses.includes(201)) {
      // A genuine both-409 outcome (neither request ever saw itself as the claim winner nor as a
      // completed replay) isn't itself impossible — repository/idempotency.ts's own comment on
      // the sibling `createOrder` check acknowledges a claim row's own insert may not yet be
      // visible to a near-simultaneous read — so retry once with the same key rather than assume
      // the system is permanently stuck.
      const retry = await SELF.fetch(CHECKOUT_BASE, requestInit);
      statuses = [retry.status];
    }
    expect(statuses).toContain(201);
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);

    const orderCount = await env.DB.prepare('SELECT COUNT(*) as count FROM plugin_commerce_orders').first<{ count: number }>();
    expect(orderCount?.count).toBe(1);
  });

  it('a stale idempotency claim (the original request crashed before completing) is reclaimed rather than blocking the key forever', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const { cookie } = await addToGuestCart(product.id);
    const idempotencyKey = crypto.randomUUID();

    // Simulates a request that claimed the key but crashed/was killed before ever calling
    // completeIdempotencyKey — the exact shape claimIdempotencyKey's own INSERT produces, just
    // with an old createdAt (60s, well past the 30s staleness cutoff).
    const staleTimestamp = Math.floor((Date.now() - 60_000) / 1000);
    await env.DB.prepare(
      `INSERT INTO plugin_commerce_idempotency_keys (id, response_status, response_body, created_at) VALUES (?, NULL, NULL, ?)`,
    )
      .bind(`checkout:${idempotencyKey}`, staleTimestamp)
      .run();

    const res = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ email: 'guest@example.test', name: 'Guest Buyer', shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(res.status).toBe(201);
  });

  it('a genuinely recent in-progress idempotency claim is NOT reclaimed — the caller gets 409, not a second attempt to process it', async () => {
    const idempotencyKey = crypto.randomUUID();
    const recentTimestamp = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO plugin_commerce_idempotency_keys (id, response_status, response_body, created_at) VALUES (?, NULL, NULL, ?)`,
    )
      .bind(`checkout:${idempotencyKey}`, recentTimestamp)
      .run();

    const res = await SELF.fetch(CHECKOUT_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ email: 'nobody@example.test', name: 'Nobody', shippingAddress: SHIPPING_ADDRESS }),
    });
    expect(res.status).toBe(409);
  });

  it('createOrder enforces one order per idempotency key even when two calls run concurrently, bypassing the claim-table entirely (issue 2 of the payments concurrency review)', async () => {
    // Deliberately calls the repository function directly rather than through POST /checkout —
    // the plugin_commerce_idempotency_keys claim/reclaim table (above) already prevents two
    // ordinary HTTP requests with the same key from both reaching this point under normal
    // circumstances; what this proves is the DURABLE, DB-enforced invariant that's supposed to
    // hold even if that table's own 30s stale-claim recovery ever lets two executions run
    // concurrently anyway (its reclaim step only ever reassigns which request is considered "the
    // owner" — it does nothing to actually stop the original, still-running request from
    // continuing to execute). Two independent guest carts (rather than one shared cart) isolate
    // this assertion from cart-consumption/stock-race behavior, which the other concurrency tests
    // in this file already cover.
    const adminCookie = await freshAdminCookie();
    const productA = await createPublishedProduct(adminCookie);
    const variantA = await createVariant(adminCookie, productA.id, { stockQty: 5 });
    const productB = await createPublishedProduct(adminCookie);
    const variantB = await createVariant(adminCookie, productB.id, { stockQty: 5 });

    const addA = await addToGuestCart(productA.id, variantA.id, 2);
    const addB = await addToGuestCart(productB.id, variantB.id, 3);
    const cartIdA = addA.cookie!.split('=')[1]!;
    const cartIdB = addB.cookie!.split('=')[1]!;

    const db = createDb(env.DB);
    const [cartA, itemsA, cartB, itemsB] = await Promise.all([
      getGuestCart(db, cartIdA),
      listItemsWithDetail(db, cartIdA),
      getGuestCart(db, cartIdB),
      listItemsWithDetail(db, cartIdB),
    ]);

    const idempotencyKey = crypto.randomUUID();
    const [resultA, resultB] = await Promise.all([
      createOrder(db, {
        cartId: cartA!.id,
        customerId: null,
        customerEmail: 'a@example.test',
        customerName: 'Buyer A',
        currency: cartA!.currency,
        shippingAddress: SHIPPING_ADDRESS,
        items: itemsA,
        idempotencyKey,
      }),
      createOrder(db, {
        cartId: cartB!.id,
        customerId: null,
        customerEmail: 'b@example.test',
        customerName: 'Buyer B',
        currency: cartB!.currency,
        shippingAddress: SHIPPING_ADDRESS,
        items: itemsB,
        idempotencyKey,
      }),
    ]);

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (resultA.ok && resultB.ok) {
      // Both callers get back the SAME order — exactly one was ever actually created for this key.
      expect(resultA.order.id).toBe(resultB.order.id);

      // Issue 1 of the payments concurrency review: the order and its items must land together,
      // atomically — never an order row that exists with zero items (the prior two-batch design's
      // partial-state gap). Exactly one order item exists for the winning order, regardless of
      // which cart actually won the race.
      const itemCount = await env.DB.prepare('SELECT COUNT(*) as count FROM plugin_commerce_order_items WHERE order_id = ?')
        .bind(resultA.order.id)
        .first<{ count: number }>();
      expect(itemCount?.count).toBe(1);
    }

    const orderCount = await env.DB.prepare('SELECT COUNT(*) as count FROM plugin_commerce_orders').first<{ count: number }>();
    expect(orderCount?.count).toBe(1);

    // Whichever cart's speculative stock reservation "lost" the idempotency-key race was given
    // back in full — exactly one of the two variants shows its original stock untouched, the
    // other decremented by its own order line's quantity (2 or 3, matching whichever cart's
    // order actually won).
    const stockA = await env.DB.prepare('SELECT stock_qty FROM plugin_commerce_product_variants WHERE id = ?').bind(variantA.id).first<{ stock_qty: number }>();
    const stockB = await env.DB.prepare('SELECT stock_qty FROM plugin_commerce_product_variants WHERE id = ?').bind(variantB.id).first<{ stock_qty: number }>();
    const decrementedCount = [stockA?.stock_qty === 3, stockB?.stock_qty === 2].filter(Boolean).length;
    expect(decrementedCount).toBe(1);
    const untouchedCount = [stockA?.stock_qty === 5, stockB?.stock_qty === 5].filter(Boolean).length;
    expect(untouchedCount).toBe(1);
  });
});
