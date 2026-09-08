import { createDb } from '@kenresoft-cms/database';
import { paymentsRoutes } from '@kenresoft-cms/plugin-ecommerce/src/routes/payments';
import { getPaymentAttempt, listPaymentAttemptsForOrder } from '@kenresoft-cms/plugin-ecommerce/src/repository/payments';
import type { InitializePaymentInput, PluginBindings, PluginLogger, PluginPaymentsService, PluginPublicContext, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';
import { Hono } from 'hono';
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function fakeLogger(): PluginLogger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function buildTestApp(payments: PluginPaymentsService, logger: PluginLogger = fakeLogger()) {
  const app = new Hono<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();
  app.use('*', async (c, next) => {
    const ctx: PluginPublicContext = {
      pluginId: 'commerce',
      db: createDb(c.env.DB),
      media: { get: async () => null, upload: async () => { throw new Error('unused'); }, delete: async () => false },
      config: { get: async () => ({}) },
      email: { send: async () => {} },
      payments,
      logger,
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

  it('a repeated initialize call while the prior attempt is still pending at Paystack reuses the same reference instead of creating a second one', async () => {
    const order = await createPendingOrder();
    let initializeCalls = 0;
    const provider: PluginPaymentsService = {
      ...neverProvider,
      initializeTransaction: async (input) => {
        initializeCalls += 1;
        return { authorizationUrl: 'https://checkout.paystack.com/first', accessCode: 'first', reference: input.reference };
      },
      verifyTransaction: async (ref) => ({ status: 'pending', reference: ref, amount: 0, currency: '', raw: {} }),
    };
    const app = buildTestApp(provider);
    const requestInit = {
      method: 'POST' as const,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }),
    };

    const first = await app.request(`/orders/${order.id}/initialize`, requestInit, env);
    expect(first.status).toBe(200);
    const firstBody = await first.json<{ authorizationUrl: string; reference: string }>();

    const second = await app.request(`/orders/${order.id}/initialize`, requestInit, env);
    expect(second.status).toBe(200);
    const secondBody = await second.json<{ authorizationUrl: string; reference: string }>();

    expect(secondBody).toEqual(firstBody);
    // Paystack's own initialize-transaction endpoint was only ever actually called once — the
    // second call re-checked the existing reference's status (still pending) and reused it.
    expect(initializeCalls).toBe(1);

    const db = createDb(env.DB);
    const attempts = await listPaymentAttemptsForOrder(db, order.id);
    expect(attempts).toHaveLength(1);
  });

  it('a repeated initialize call after the prior attempt genuinely failed at Paystack issues a fresh reference', async () => {
    const order = await createPendingOrder();
    let initializeCalls = 0;
    const provider: PluginPaymentsService = {
      ...neverProvider,
      initializeTransaction: async (input) => {
        initializeCalls += 1;
        return { authorizationUrl: `https://checkout.paystack.com/${initializeCalls}`, accessCode: `code-${initializeCalls}`, reference: input.reference };
      },
      verifyTransaction: async (ref) => ({ status: 'failed', reference: ref, amount: 0, currency: '', raw: {} }),
    };
    const app = buildTestApp(provider);
    const requestInit = {
      method: 'POST' as const,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }),
    };

    const first = await app.request(`/orders/${order.id}/initialize`, requestInit, env);
    const firstBody = await first.json<{ reference: string }>();

    const second = await app.request(`/orders/${order.id}/initialize`, requestInit, env);
    expect(second.status).toBe(200);
    const secondBody = await second.json<{ reference: string }>();

    expect(secondBody.reference).not.toBe(firstBody.reference);
    expect(initializeCalls).toBe(2);

    const db = createDb(env.DB);
    const attempts = await listPaymentAttemptsForOrder(db, order.id);
    expect(attempts).toHaveLength(2);
    expect(attempts.find((a) => a.reference === firstBody.reference)?.status).toBe('failed');
    expect(attempts.find((a) => a.reference === secondBody.reference)?.status).toBe('pending');
  });

  it('a repeated initialize call after the prior attempt already succeeded is rejected (the order is no longer pending)', async () => {
    const order = await createPendingOrder();
    const provider: PluginPaymentsService = {
      ...neverProvider,
      initializeTransaction: async (input) => ({ authorizationUrl: 'https://x', accessCode: 'x', reference: input.reference }),
      verifyTransaction: async (ref) => ({ status: 'success', reference: ref, amount: order.totalAmount, currency: order.currency, raw: {} }),
    };
    const app = buildTestApp(provider);
    const requestInit = {
      method: 'POST' as const,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }),
    };

    await app.request(`/orders/${order.id}/initialize`, requestInit, env);
    const second = await app.request(`/orders/${order.id}/initialize`, requestInit, env);
    expect(second.status).toBe(400);

    const db = createDb(env.DB);
    const orderRow = await db.query.pluginCommerceOrders.findFirst({ where: (o, { eq }) => eq(o.id, order.id) });
    expect(orderRow?.status).toBe('paid');
  });

  it('a stale, unauthorized payment claim (the claiming request crashed before persisting an authorizationUrl) is reclaimed rather than blocking the order forever (issue 2 of the payments concurrency review)', async () => {
    const order = await createPendingOrder();
    // Simulates exactly what claimPendingPaymentAttempt's own INSERT produces — a 'pending' row
    // with no authorizationUrl — but with a createdAt well past the 30s staleness cutoff, as if
    // the Worker that claimed it died before ever calling Paystack (or before persisting the
    // result), rather than genuinely still being in flight.
    const staleReference = crypto.randomUUID();
    const staleTimestamp = Math.floor((Date.now() - 60_000) / 1000);
    await env.DB.prepare(
      `INSERT INTO plugin_commerce_order_payments (id, order_id, provider, reference, status, created_at) VALUES (?, ?, 'paystack', ?, 'pending', ?)`,
    )
      .bind(crypto.randomUUID(), order.id, staleReference, staleTimestamp)
      .run();

    let initializeCalls = 0;
    const provider: PluginPaymentsService = {
      ...neverProvider,
      initializeTransaction: async (input) => {
        initializeCalls += 1;
        return { authorizationUrl: 'https://checkout.paystack.com/fresh', accessCode: 'fresh', reference: input.reference };
      },
      // Paystack has never heard of the stale reference either — the claiming request died
      // before ever reaching Paystack, not merely before persisting the result locally.
      verifyTransaction: async () => {
        throw new Error('unknown reference');
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
    expect(body.authorizationUrl).toBe('https://checkout.paystack.com/fresh');
    expect(body.reference).not.toBe(staleReference);
    expect(initializeCalls).toBe(1);

    const db = createDb(env.DB);
    const staleAttempt = await getPaymentAttempt(db, staleReference);
    expect(staleAttempt?.status).toBe('failed');
    const attempts = await listPaymentAttemptsForOrder(db, order.id);
    expect(attempts).toHaveLength(2);
  });

  it('a stale, unauthorized payment claim that Paystack actually confirms succeeded (a crash after the charge but before the local record) settles the order as paid instead of being discarded', async () => {
    const order = await createPendingOrder();
    const staleReference = crypto.randomUUID();
    const staleTimestamp = Math.floor((Date.now() - 60_000) / 1000);
    await env.DB.prepare(
      `INSERT INTO plugin_commerce_order_payments (id, order_id, provider, reference, status, created_at) VALUES (?, ?, 'paystack', ?, 'pending', ?)`,
    )
      .bind(crypto.randomUUID(), order.id, staleReference, staleTimestamp)
      .run();

    const provider: PluginPaymentsService = {
      ...neverProvider,
      verifyTransaction: async (ref) => ({ status: 'success', reference: ref, amount: order.totalAmount, currency: order.currency, raw: {} }),
    };
    const app = buildTestApp(provider);

    const res = await app.request(
      `/orders/${order.id}/initialize`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }) },
      env,
    );
    // Never silently discarded as "abandoned" just because it was stale and unauthorized locally
    // — Paystack's own record is checked first, and it says this reference genuinely succeeded.
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toContain('already been paid');

    const db = createDb(env.DB);
    const orderRow = await db.query.pluginCommerceOrders.findFirst({ where: (o, { eq }) => eq(o.id, order.id) });
    expect(orderRow?.status).toBe('paid');
    const attempt = await getPaymentAttempt(db, staleReference);
    expect(attempt?.status).toBe('success');
  });

  it('a recent (not yet stale) unauthorized payment claim is NOT reclaimed — the caller gets 409, not a second Paystack initialization', async () => {
    const order = await createPendingOrder();
    const recentReference = crypto.randomUUID();
    const recentTimestamp = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO plugin_commerce_order_payments (id, order_id, provider, reference, status, created_at) VALUES (?, ?, 'paystack', ?, 'pending', ?)`,
    )
      .bind(crypto.randomUUID(), order.id, recentReference, recentTimestamp)
      .run();

    const app = buildTestApp(neverProvider);
    const res = await app.request(
      `/orders/${order.id}/initialize`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }) },
      env,
    );
    expect(res.status).toBe(409);

    const db = createDb(env.DB);
    const attempt = await getPaymentAttempt(db, recentReference);
    expect(attempt?.status).toBe('pending');
  });

  it('two genuinely concurrent initialize calls for the same order result in exactly one Paystack initialization (issue 1 of the payments concurrency review)', async () => {
    const order = await createPendingOrder();
    let initializeCalls = 0;
    const provider: PluginPaymentsService = {
      ...neverProvider,
      initializeTransaction: async (input) => {
        initializeCalls += 1;
        return { authorizationUrl: `https://checkout.paystack.com/${input.reference}`, accessCode: 'x', reference: input.reference };
      },
      // In case the loser of the atomic claim race instead lands on the "existing attempt found,
      // re-verify it" path (a legitimate alternative interleaving) rather than a 409 — a
      // non-terminal status means it just reuses the winner's session, still without ever calling
      // initializeTransaction a second time.
      verifyTransaction: async (ref) => ({ status: 'pending', reference: ref, amount: 0, currency: '', raw: {} }),
    };
    const app = buildTestApp(provider);
    const requestInit = {
      method: 'POST' as const,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }),
    };

    const [resA, resB] = await Promise.all([
      app.request(`/orders/${order.id}/initialize`, requestInit, env),
      app.request(`/orders/${order.id}/initialize`, requestInit, env),
    ]);

    // The actual assertion: Paystack's own initialize-transaction endpoint was called exactly
    // once, no matter which of the two requests "won" — the atomic claim (a real partial unique
    // index, not just application-level checking) guarantees this regardless of timing.
    expect(initializeCalls).toBe(1);

    const statuses = [resA.status, resB.status].sort();
    // The loser either gets a 409 (the winner hadn't stored an authorizationUrl yet when it
    // looked) or a 200 reusing the winner's session (the winner had already finished) — both are
    // legitimate outcomes of "never call Paystack twice," unlike a second distinct reference.
    expect([200, 409]).toContain(statuses[0]);
    expect(statuses[1]).toBe(200);

    if (resA.status === 200 && resB.status === 200) {
      const [bodyA, bodyB] = await Promise.all([resA.json<{ reference: string }>(), resB.json<{ reference: string }>()]);
      expect(bodyA.reference).toBe(bodyB.reference);
    }

    const db = createDb(env.DB);
    const attempts = await listPaymentAttemptsForOrder(db, order.id);
    expect(attempts).toHaveLength(1);
  });

  // The reference is now generated internally by claimPendingPaymentAttempt (an atomic DB
  // reservation, made BEFORE Paystack is ever called — see repository/payments.ts), not chosen
  // by the caller — so this returns whatever reference the endpoint actually used, matching a
  // real Paystack provider's contract of echoing back the exact reference it was given.
  async function initialize(order: { id: string }): Promise<string> {
    const provider: PluginPaymentsService = {
      ...neverProvider,
      initializeTransaction: async (input) => ({ authorizationUrl: 'https://x', accessCode: 'x', reference: input.reference }),
    };
    const app = buildTestApp(provider);
    const res = await app.request(
      `/orders/${order.id}/initialize`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callbackUrl: ALLOWED_CALLBACK }) },
      env,
    );
    const body = await res.json<{ reference: string }>();
    return body.reference;
  }

  it('verify transitions a pending order to paid when the provider confirms success with matching amount/currency', async () => {
    const order = await createPendingOrder();
    const reference = await initialize(order);

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
    const reference = await initialize(order);

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
    const reference = await initialize(order);

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

  it.each(['pending', 'ongoing', 'processing', 'queued'] as const)(
    'verify leaves the attempt pending and the order unpaid for Paystack status %s, rather than treating it as a failure',
    async (paystackStatus) => {
      const order = await createPendingOrder();
      const reference = await initialize(order);

      const provider: PluginPaymentsService = {
        ...neverProvider,
        verifyTransaction: async (ref) => ({ status: paystackStatus, reference: ref, amount: order.totalAmount, currency: order.currency, raw: {} }),
      };
      const app = buildTestApp(provider);
      const res = await app.request(`/orders/${order.id}/verify?reference=${reference}`, {}, env);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ orderStatus: 'pending', paid: false });

      const db = createDb(env.DB);
      const attempt = await getPaymentAttempt(db, reference);
      expect(attempt?.status).toBe('pending');
    },
  );

  it.each(['failed', 'abandoned'] as const)(
    'verify resolves the attempt as failed for Paystack status %s, without touching the order (it stays pending, so the customer can retry)',
    async (paystackStatus) => {
      const order = await createPendingOrder();
      const reference = await initialize(order);

      const provider: PluginPaymentsService = {
        ...neverProvider,
        verifyTransaction: async (ref) => ({ status: paystackStatus, reference: ref, amount: order.totalAmount, currency: order.currency, raw: {} }),
      };
      const app = buildTestApp(provider);
      const res = await app.request(`/orders/${order.id}/verify?reference=${reference}`, {}, env);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ orderStatus: 'pending', paid: false });

      const db = createDb(env.DB);
      const attempt = await getPaymentAttempt(db, reference);
      expect(attempt?.status).toBe('failed');
    },
  );

  it('cancellation-vs-payment race: an order cancelled while its payment is still pending is never silently marked paid when Paystack later reports success', async () => {
    const order = await createPendingOrder();
    const reference = await initialize(order);

    // The order is cancelled (e.g. by an admin) while the payment is still in flight at Paystack.
    const cancel = await SELF.fetch(`${ADMIN_BASE}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { Cookie: order.adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    expect(cancel.status).toBe(200);

    // Paystack's charge.success webhook for that same reference arrives after the cancellation.
    const errorSpy = vi.fn();
    const payload = JSON.stringify({ event: 'charge.success', data: { reference, amount: order.totalAmount, currency: order.currency, status: 'success' } });
    const app = buildTestApp({ ...neverProvider, verifyWebhookSignature: async () => true }, { info: () => {}, warn: () => {}, error: errorSpy });
    const res = await app.request('/webhook', { method: 'POST', headers: { 'x-paystack-signature': 'valid' }, body: payload }, env);
    expect(res.status).toBe(200);

    // Authoritative policy: the order's CMS status is never silently overwritten by an async
    // payment confirmation arriving after an explicit cancellation — it stays cancelled, not paid.
    const db = createDb(env.DB);
    const orderRow = await db.query.pluginCommerceOrders.findFirst({ where: (o, { eq }) => eq(o.id, order.id) });
    expect(orderRow?.status).toBe('cancelled');

    // The money genuinely moved, though — the ledger still records it as a real success, not
    // silently dropped, so there's an actual trail for manual refund/reconciliation.
    const attempt = await getPaymentAttempt(db, reference);
    expect(attempt?.status).toBe('success');

    // And it's not a silent conflict — this deployment logs it loudly for a human to act on.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('no longer pending'),
      expect.objectContaining({ orderId: order.id, reference, orderStatus: 'cancelled' }),
    );
  });

  it('webhook rejects an invalid signature', async () => {
    const app = buildTestApp({ ...neverProvider, verifyWebhookSignature: async () => false });
    const res = await app.request('/webhook', { method: 'POST', headers: { 'x-paystack-signature': 'wrong' }, body: '{}' }, env);
    expect(res.status).toBe(400);
  });

  it('webhook resolves a pending reference to paid, and a retried delivery is a safe no-op', async () => {
    const order = await createPendingOrder();
    const reference = await initialize(order);

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
