import { createDb } from '@kenresoft-cms/database';
import { createCustomerSession } from '@kenresoft-cms/plugin-ecommerce/src/repository/customer-sessions';
import { createCustomer } from '@kenresoft-cms/plugin-ecommerce/src/repository/customers';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const ADMIN_BASE = 'https://example.com/api/plugins/commerce/v1';
const CART_BASE = 'https://example.com/api/plugins/commerce/public/v1/cart';
const CHECKOUT_BASE = 'https://example.com/api/plugins/commerce/public/v1/checkout';
const CUSTOMER_BASE = 'https://example.com/api/plugins/commerce/public/v1/customer';

const SHIPPING_ADDRESS = {
  recipientName: 'Jane Doe',
  line1: '1 Market Street',
  city: 'Lagos',
  postalCode: '100001',
  country: 'NG',
};

async function freshAdminCookie(email = 'commerce-orders-admin@example.test'): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery staple', name: 'Admin' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

async function signUpEditor(): Promise<string> {
  // First signup becomes admin (this codebase's own bootstrap rule); a second signup defaults to
  // editor. Promote nobody — this is exactly the role floor being tested.
  await freshAdminCookie('commerce-orders-bootstrap@example.test');
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'commerce-orders-editor@example.test', password: 'correct horse battery staple', name: 'Editor' }),
  });
  const setCookie = response.headers.get('set-cookie');
  return setCookie!.split(';')[0]!;
}

async function createPublishedProduct(adminCookie: string) {
  const response = await SELF.fetch(`${ADMIN_BASE}/products`, {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Widget', slug: `widget-${crypto.randomUUID()}`, basePrice: 1000, currency: 'NGN', status: 'published' }),
  });
  return response.json<{ id: string }>();
}

async function createVariant(adminCookie: string, productId: string, overrides: Record<string, unknown> = {}) {
  const response = await SELF.fetch(`${ADMIN_BASE}/products/${productId}/variants`, {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Small', stockQty: 5, ...overrides }),
  });
  return response.json<{ id: string }>();
}

async function registeredCustomer(email: string) {
  const db = createDb(env.DB);
  const customer = await createCustomer(db, { email, name: 'Test Customer', password: 'correct horse battery staple' });
  const rawToken = await createCustomerSession(db, customer.id);
  return { customer, cookie: `commerce_customer_session=${rawToken}` };
}

async function placeOrder(customerCookie: string, productId: string, variantId?: string, quantity = 1) {
  await SELF.fetch(`${CART_BASE}/items`, {
    method: 'POST',
    headers: { Cookie: customerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, variantId, quantity }),
  });
  const res = await SELF.fetch(CHECKOUT_BASE, {
    method: 'POST',
    headers: { Cookie: customerCookie, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ shippingAddress: SHIPPING_ADDRESS }),
  });
  return res.json<{ id: string; status: string }>();
}

describe('commerce plugin: order management (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_order_items');
    await env.DB.exec('DELETE FROM plugin_commerce_orders');
    await env.DB.exec('DELETE FROM plugin_commerce_cart_items');
    await env.DB.exec('DELETE FROM plugin_commerce_carts');
    await env.DB.exec('DELETE FROM plugin_commerce_customer_sessions');
    await env.DB.exec('DELETE FROM plugin_commerce_customers');
    await env.DB.exec('DELETE FROM plugin_commerce_product_variants');
    await env.DB.exec('DELETE FROM plugin_commerce_products');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('admin: 403s listing below editor is not possible to construct — editor is the floor, and it succeeds', async () => {
    const editorCookie = await signUpEditor();
    const res = await SELF.fetch(`${ADMIN_BASE}/orders`, { headers: { Cookie: editorCookie } });
    expect(res.status).toBe(200);
  });

  it('admin: rejects listing/detail/status-update with no session', async () => {
    const list = await SELF.fetch(`${ADMIN_BASE}/orders`);
    expect(list.status).toBe(401);
  });

  it('admin: lists orders, filters by status, gets a detail view with items and address, and transitions status validly/invalidly', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const variant = await createVariant(adminCookie, product.id, { stockQty: 5 });
    const { cookie: customerCookie } = await registeredCustomer('order-admin-flow@example.test');

    const order = await placeOrder(customerCookie, product.id, variant.id, 2);
    expect(order.status).toBe('pending');

    const list = await SELF.fetch(`${ADMIN_BASE}/orders`, { headers: { Cookie: adminCookie } });
    const listBody = await list.json<Array<{ id: string }>>();
    expect(listBody.some((o) => o.id === order.id)).toBe(true);

    const filtered = await SELF.fetch(`${ADMIN_BASE}/orders?status=paid`, { headers: { Cookie: adminCookie } });
    const filteredBody = await filtered.json<Array<{ id: string }>>();
    expect(filteredBody.some((o) => o.id === order.id)).toBe(false);

    const detail = await SELF.fetch(`${ADMIN_BASE}/orders/${order.id}`, { headers: { Cookie: adminCookie } });
    const detailBody = await detail.json<{ shippingAddress: { city: string }; items: Array<{ quantity: number }> }>();
    expect(detailBody.shippingAddress.city).toBe('Lagos');
    expect(detailBody.items).toHaveLength(1);
    expect(detailBody.items[0]!.quantity).toBe(2);

    // Invalid transition: pending -> fulfilled is not allowed (must go through paid first).
    const badTransition = await SELF.fetch(`${ADMIN_BASE}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'fulfilled' }),
    });
    expect(badTransition.status).toBe(400);

    // Valid: pending -> paid -> fulfilled.
    const toPaid = await SELF.fetch(`${ADMIN_BASE}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paid' }),
    });
    expect(toPaid.status).toBe(200);
    expect((await toPaid.json<{ status: string }>()).status).toBe('paid');

    const toFulfilled = await SELF.fetch(`${ADMIN_BASE}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'fulfilled' }),
    });
    expect(toFulfilled.status).toBe(200);
  });

  it('admin: 404s a nonexistent order id', async () => {
    const adminCookie = await freshAdminCookie();
    const res = await SELF.fetch(`${ADMIN_BASE}/orders/not-a-real-id`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(404);
  });

  it('cancelling an order restocks its tracked-variant lines exactly once', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const variant = await createVariant(adminCookie, product.id, { stockQty: 5 });
    const { cookie: customerCookie } = await registeredCustomer('order-cancel@example.test');

    const order = await placeOrder(customerCookie, product.id, variant.id, 2);

    const afterCheckout = await env.DB.prepare('SELECT stock_qty FROM plugin_commerce_product_variants WHERE id = ?')
      .bind(variant.id)
      .first<{ stock_qty: number }>();
    expect(afterCheckout?.stock_qty).toBe(3);

    const cancel = await SELF.fetch(`${ADMIN_BASE}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    expect(cancel.status).toBe(200);

    const afterCancel = await env.DB.prepare('SELECT stock_qty FROM plugin_commerce_product_variants WHERE id = ?')
      .bind(variant.id)
      .first<{ stock_qty: number }>();
    expect(afterCancel?.stock_qty).toBe(5);

    // Terminal: cancelled cannot transition anywhere else, so it can never restock twice.
    const reCancel = await SELF.fetch(`${ADMIN_BASE}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    expect(reCancel.status).toBe(400);
  });

  it('customer: lists only their own orders, and 404s another customer’s order id', async () => {
    const adminCookie = await freshAdminCookie();
    const product = await createPublishedProduct(adminCookie);
    const { cookie: cookieA } = await registeredCustomer('order-history-a@example.test');
    const { cookie: cookieB } = await registeredCustomer('order-history-b@example.test');

    const orderA = await placeOrder(cookieA, product.id);
    await placeOrder(cookieB, product.id);

    const listA = await SELF.fetch(`${CUSTOMER_BASE}/orders`, { headers: { Cookie: cookieA } });
    const listABody = await listA.json<Array<{ id: string }>>();
    expect(listABody).toHaveLength(1);
    expect(listABody[0]!.id).toBe(orderA.id);

    const detailOwn = await SELF.fetch(`${CUSTOMER_BASE}/orders/${orderA.id}`, { headers: { Cookie: cookieA } });
    expect(detailOwn.status).toBe(200);

    const detailOther = await SELF.fetch(`${CUSTOMER_BASE}/orders/${orderA.id}`, { headers: { Cookie: cookieB } });
    expect(detailOther.status).toBe(404);
  });

  it('customer: order-history routes 401 without a session', async () => {
    const res = await SELF.fetch(`${CUSTOMER_BASE}/orders`);
    expect(res.status).toBe(401);
  });
});
