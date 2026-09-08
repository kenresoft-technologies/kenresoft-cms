import { createDb } from '@kenresoft-cms/database';
import { paymentsRoutes } from '@kenresoft-cms/plugin-ecommerce/src/routes/payments';
import { getPaymentAttempt, listPaymentAttemptsForOrder } from '@kenresoft-cms/plugin-ecommerce/src/repository/payments';
import type { InitializePaymentInput, PluginBindings, PluginPaymentsService, PluginPublicContext, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';
import { Hono } from 'hono';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// payments.ts's own logic (idempotent resolution, amount/currency validation, reference-ownership
// checks, callbackUrl origin validation) is tested here against a hand-injected fake
// PluginPaymentsService, bypassing SELF.fetch/the full apps/api Worker entirely — mirrors
// plugin-rate-limit.test.ts's own "test this middleware/route file in isolation, not the whole
// app" pattern. This sidesteps needing either a real Paystack account (none available for this
// automated suite) or mocking global fetch through a SELF.fetch dispatch (untested territory in
// this codebase); paystack-provider.test.ts separately covers the real HTTP-calling provider code
// this file never exercises. The order itself is still created via the REAL checkout flow
// (SELF.fetch against the actual Worker) — no reason to fake that part, checkout doesn't touch
// Paystack at all.
const ADMIN_BASE = 'https://example.com/api/plugins/commerce/v1';
const CART_BASE = 'https://example.com/api/plugins/commerce/public/v1/cart';
const CHECKOUT_BASE = 'https://example.com/api/plugins/commerce/public/v1/checkout';
const ALLOWED_CALLBACK = 'http://localhost:5173/thank-you';

function fakeLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function buildTestApp(payments: PluginPaymentsService) {
  const app = new Hono<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();
  app.use('*', async (c, next) => {
    const ctx: PluginPublicContext = {
      pluginId: 'commerce',
      db: createDb(c.env.DB),
      media: { get: async () => null, upload: async () => { throw new Error('unused'); }, delete: async () => false },
      config: { get: async () => ({}) },
      email: { send: async () => {} },
      payments,
      logger: fakeLogger(),
    };
    c.set('pluginContext', ctx);
    await next();
  });
  app.route('/', paymentsRoutes);
  return app;
}

async function freshAdminCookie(): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'commerce-payments-admin@example.test', password: 'correct horse battery staple', name: 'Admin' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

async function createPublishedProduct(adminCookie: string) {
  const response = await SELF.fetch(`${ADMIN_BASE}/products`, {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Widget', slug: `widget-${crypto.randomUUID()}`, basePrice: 5000, currency: 'NGN', status: 'published' }),
  });
  return response.json<{ id: string }>();
}

async function createPendingOrder(): Promise<{ id: string; totalAmount: number; currency: string; adminCookie: string }> {
  const adminCookie = await freshAdminCookie();
  const product = await createPublishedProduct(adminCookie);
  const addRes = await SELF.fetch(`${CART_BASE}/items`, {
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

  const res = await SELF.fetch(CHECKOUT_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), Cookie: guestCartCookie },
    body: JSON.stringify({
      email: 'buyer@example.test',
      name: 'Buyer',
      shippingAddress: { recipientName: 'Buyer', line1: '1 Main St', city: 'Lagos', postalCode: '100001', country: 'NG' },
    }),
  });
  expect(res.status).toBe(201);
  const order = await res.json<{ id: string; totalAmount: number; currency: string }>();
  return { ...order, adminCookie };
}

const neverProvider: PluginPaymentsService = {
  configured: true,
  initializeTransaction: () => {
    throw new Error('should not be called in this test');
  },
  verifyTransaction: () => {
    throw new Error('should not be called in this test');
  },
  verifyWebhookSignature: async () => true,
};

describe('commerce plugin: payments (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM plugin_commerce_order_payments');
    await env.DB.exec('DELETE FROM plugin_commerce_order_items');
    await env.DB.exec('DELETE FROM plugin_commerce_orders');
    await env.DB.exec('DELETE FROM plugin_commerce_cart_items');
    await env.DB.exec('DELETE FROM plugin_commerce_carts');
    await env.DB.exec('DELETE FROM plugin_commerce_customers');
    await env.DB.exec('DELETE FROM plugin_commerce_product_variants');
    await env.DB.exec('DELETE FROM plugin_commerce_products');
    await env.DB.exec('DELETE FROM plugin_commerce_idempotency_keys');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('rejects initializing payment when the deployment has no payments configured', async () => {
    const order = await createPendingOrder();
    const app = buildTestApp({ ...neverProvider, configured: false });
    const res = await app.request(
      `/orders/${order.id}/initialize`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }) },
      env,
    );
    expect(res.status).toBe(503);
  });

  it('rejects a callbackUrl that is not one of this deployment’s CORS origins', async () => {
    const order = await createPendingOrder();
    const app = buildTestApp(neverProvider);
    const res = await app.request(
      `/orders/${order.id}/initialize`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callbackUrl: 'https://attacker.example/callback' }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('initializes a transaction for a pending order and records a pending payment attempt', async () => {
    const order = await createPendingOrder();
    let capturedInput: InitializePaymentInput | undefined;
    const provider: PluginPaymentsService = {
      ...neverProvider,
      initializeTransaction: async (input) => {
        capturedInput = input;
        return { authorizationUrl: 'https://checkout.paystack.com/xyz', accessCode: 'xyz', reference: input.reference };
      },
    };
    const app = buildTestApp(provider);

    const res = await app.request(
      `/orders/${order.id}/initialize`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }) },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ authorizationUrl: string; reference: string }>();
    expect(body.authorizationUrl).toBe('https://checkout.paystack.com/xyz');
    expect(capturedInput).toMatchObject({ amount: order.totalAmount, currency: order.currency, email: 'buyer@example.test', callbackUrl: ALLOWED_CALLBACK });

    const db = createDb(env.DB);
    const attempt = await getPaymentAttempt(db, body.reference);
    expect(attempt).toMatchObject({ orderId: order.id, status: 'pending' });
  });

  it('rejects initializing payment for an order that is not pending', async () => {
    const order = await createPendingOrder();
    await SELF.fetch(`${ADMIN_BASE}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { Cookie: order.adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });

    const app = buildTestApp(neverProvider);
    const res = await app.request(
      `/orders/${order.id}/initialize`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  async function initialize(order: { id: string }, reference: string) {
    const provider: PluginPaymentsService = { ...neverProvider, initializeTransaction: async () => ({ authorizationUrl: 'https://x', accessCode: 'x', reference }) };
    const app = buildTestApp(provider);
    await app.request(
      `/orders/${order.id}/initialize`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }) },
      env,
    );
  }

  it('verify transitions a pending order to paid when the provider confirms success with matching amount/currency', async () => {
    const order = await createPendingOrder();
    const reference = crypto.randomUUID();
    await initialize(order, reference);

    const provider: PluginPaymentsService = {
      ...neverProvider,
      verifyTransaction: async (ref) => ({ status: 'success', reference: ref, amount: order.totalAmount, currency: order.currency, raw: {} }),
    };
    const app = buildTestApp(provider);
    const res = await app.request(`/orders/${order.id}/verify?reference=${reference}`, {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orderStatus: 'paid', paid: true });
  });

  it('verify rejects a reference that does not belong to the order', async () => {
    const order = await createPendingOrder();
    const app = buildTestApp(neverProvider);
    const res = await app.request(`/orders/${order.id}/verify?reference=not-a-real-reference`, {}, env);
    expect(res.status).toBe(400);
  });

  it('verify 409s and does not transition the order when the provider’s amount does not match', async () => {
    const order = await createPendingOrder();
    const reference = crypto.randomUUID();
    await initialize(order, reference);

    const provider: PluginPaymentsService = {
      ...neverProvider,
      verifyTransaction: async (ref) => ({ status: 'success', reference: ref, amount: order.totalAmount + 1, currency: order.currency, raw: {} }),
    };
    const app = buildTestApp(provider);
    const res = await app.request(`/orders/${order.id}/verify?reference=${reference}`, {}, env);
    expect(res.status).toBe(409);

    const db = createDb(env.DB);
    const attempt = await getPaymentAttempt(db, reference);
    expect(attempt?.status).toBe('pending');
  });

  it('verify is idempotent: a second call for an already-resolved reference does not re-call the provider or double-process', async () => {
    const order = await createPendingOrder();
    const reference = crypto.randomUUID();
    await initialize(order, reference);

    let verifyCalls = 0;
    const provider: PluginPaymentsService = {
      ...neverProvider,
      verifyTransaction: async (ref) => {
        verifyCalls += 1;
        return { status: 'success', reference: ref, amount: order.totalAmount, currency: order.currency, raw: {} };
      },
    };
    const app = buildTestApp(provider);

    const first = await app.request(`/orders/${order.id}/verify?reference=${reference}`, {}, env);
    expect(first.status).toBe(200);
    const second = await app.request(`/orders/${order.id}/verify?reference=${reference}`, {}, env);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ orderStatus: 'paid', paid: true });

    // The provider's own verifyTransaction is only ever called once the payment attempt is still
    // 'pending' — the second call finds it already resolved and skips calling the provider again.
    expect(verifyCalls).toBe(1);

    const db = createDb(env.DB);
    const attempts = await listPaymentAttemptsForOrder(db, order.id);
    expect(attempts).toHaveLength(1);
  });

  it('webhook rejects an invalid signature', async () => {
    const app = buildTestApp({ ...neverProvider, verifyWebhookSignature: async () => false });
    const res = await app.request('/webhook', { method: 'POST', headers: { 'x-paystack-signature': 'wrong' }, body: '{}' }, env);
    expect(res.status).toBe(400);
  });

  it('webhook resolves a pending reference to paid, and a retried delivery is a safe no-op', async () => {
    const order = await createPendingOrder();
    const reference = crypto.randomUUID();
    await initialize(order, reference);

    const payload = JSON.stringify({ event: 'charge.success', data: { reference, amount: order.totalAmount, currency: order.currency, status: 'success' } });
    const app = buildTestApp({ ...neverProvider, verifyWebhookSignature: async () => true });

    const first = await app.request('/webhook', { method: 'POST', headers: { 'x-paystack-signature': 'valid' }, body: payload }, env);
    expect(first.status).toBe(200);

    const db = createDb(env.DB);
    const orderRow = await db.query.pluginCommerceOrders.findFirst({ where: (o, { eq }) => eq(o.id, order.id) });
    expect(orderRow?.status).toBe('paid');

    // A retried delivery of the exact same event (Paystack does this) must not error or re-fire
    // anything — the attempt is already resolved, so this is a pure no-op.
    const second = await app.request('/webhook', { method: 'POST', headers: { 'x-paystack-signature': 'valid' }, body: payload }, env);
    expect(second.status).toBe(200);

    const attempts = await listPaymentAttemptsForOrder(db, order.id);
    expect(attempts).toHaveLength(1);
  });

  it('webhook acknowledges but ignores an event type it does not act on', async () => {
    const app = buildTestApp({ ...neverProvider, verifyWebhookSignature: async () => true });
    const res = await app.request(
      '/webhook',
      { method: 'POST', headers: { 'x-paystack-signature': 'valid' }, body: JSON.stringify({ event: 'charge.failed', data: { reference: 'whatever' } }) },
      env,
    );
    expect(res.status).toBe(200);
  });

  it('webhook acknowledges but does not act on an unknown reference', async () => {
    const app = buildTestApp({ ...neverProvider, verifyWebhookSignature: async () => true });
    const res = await app.request(
      '/webhook',
      { method: 'POST', headers: { 'x-paystack-signature': 'valid' }, body: JSON.stringify({ event: 'charge.success', data: { reference: 'never-issued', amount: 1, currency: 'NGN', status: 'success' } }) },
      env,
    );
    expect(res.status).toBe(200);
  });
});
