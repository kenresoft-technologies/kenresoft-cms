import { createDb } from '@kenresoft-cms/database';
import { createCustomerSession } from '@kenresoft-cms/plugin-ecommerce/src/repository/customer-sessions';
import { createCustomer } from '@kenresoft-cms/plugin-ecommerce/src/repository/customers';
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
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
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
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
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
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
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
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
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
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
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
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
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
        headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ shippingAddress: SHIPPING_ADDRESS }),
      }),
      SELF.fetch(CHECKOUT_BASE, {
        method: 'POST',
        headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
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
});
