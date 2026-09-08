import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicContext, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';
import type { PluginCommerceOrder } from '@kenresoft-cms/database';

import { getOrderById } from '../repository/orders';
import { getPaymentAttempt, initializePaymentAttempt, resolvePaymentAttempt } from '../repository/payments';

// Public: checkout/payment confirmation must work for a guest with no session at all. Unlike
// cart/customer/customer-auth, these routes carry no cookie-based identity to forge in the first
// place — authorization here is "knowledge of the order id" (an unguessable UUID returned once,
// in the checkout response), the same bearer-capability model Phase 2b's guest cart id already
// established — so requireTrustedOriginForMutations (a CSRF defense specifically for
// cookie-authenticated mutations) doesn't apply and isn't used here.
export const paymentsRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();

const errorSchema = z.object({ error: z.string() });
const orderIdParamSchema = z.object({ orderId: z.string().min(1) });

function isAllowedCallbackOrigin(corsOrigins: string, callbackUrl: string): boolean {
  let origin: string;
  try {
    origin = new URL(callbackUrl).origin;
  } catch {
    return false;
  }
  const allowList = corsOrigins
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowList.includes(origin);
}

// Shared by the verify route and the webhook route below — both eventually reduce to "here is a
// {reference, status, amount, currency} tuple from the provider (an API response for verify, a
// signed payload for the webhook); reconcile it against the payment-attempt ledger and, if it's a
// genuine still-pending success, transition the order." resolvePaymentAttempt's own conditional
// UPDATE is what makes calling this twice for the same reference (a retried webhook delivery, a
// duplicate verify request racing it) safe — see repository/payments.ts.
async function settlePayment(
  ctx: PluginPublicContext,
  order: PluginCommerceOrder,
  data: { reference: string; status: 'success' | 'failed'; amount: number; currency: string; raw: unknown },
): Promise<{ outcome: 'success' | 'failed' | 'mismatch' | 'already_resolved' | 'unknown_reference' }> {
  if (data.status === 'success' && (data.amount !== order.totalAmount || data.currency !== order.currency)) {
    // The transaction genuinely succeeded at Paystack, just not for the amount/currency this
    // order expects — never transition on this. Deliberately left as a 'pending' payment-attempt
    // row (not resolved either way) for manual investigation rather than inventing a fourth
    // ledger status for what should never happen if checkout/initialize built the request
    // correctly in the first place.
    ctx.logger.error('Commerce payment amount/currency mismatch', {
      orderId: order.id,
      reference: data.reference,
      expected: { amount: order.totalAmount, currency: order.currency },
      got: { amount: data.amount, currency: data.currency },
    });
    return { outcome: 'mismatch' };
  }

  const result = await resolvePaymentAttempt(ctx.db, data);
  if (!result.ok) return { outcome: 'unknown_reference' };
  if (result.alreadyResolved) return { outcome: 'already_resolved' };
  return { outcome: data.status === 'success' ? 'success' : 'failed' };
}

const initializeSchema = z.object({ callbackUrl: z.string().url() });
const initializeResponseSchema = z.object({ authorizationUrl: z.string(), reference: z.string() });

paymentsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/orders/{orderId}/initialize',
    tags: ['Commerce Payments'],
    summary: 'Initialize a Paystack transaction for a pending order',
    request: { params: orderIdParamSchema, body: { content: { 'application/json': { schema: initializeSchema } } } },
    responses: {
      200: { description: 'Redirect the browser to authorizationUrl.', content: { 'application/json': { schema: initializeResponseSchema } } },
      400: { description: 'An invalid callbackUrl, or the order is not in a payable state.', content: { 'application/json': { schema: errorSchema } } },
      404: { description: 'No order with that id.', content: { 'application/json': { schema: errorSchema } } },
      502: { description: 'The payment provider itself returned an error.', content: { 'application/json': { schema: errorSchema } } },
      503: { description: 'Payments are not configured for this deployment.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    if (!ctx.payments.configured) return c.json({ error: 'Payments are not configured for this deployment' }, 503);

    const { orderId } = c.req.valid('param');
    const { callbackUrl } = c.req.valid('json');

    // callbackUrl is where Paystack redirects the browser after payment — restricted to this
    // deployment's own CORS_ORIGINS allow-list (the same list already trusted for browser-JS
    // access to this API) rather than accepted verbatim, closing off this endpoint as an
    // open-redirect-adjacent primitive for an arbitrary attacker-chosen destination.
    if (!isAllowedCallbackOrigin(c.env.CORS_ORIGINS, callbackUrl)) {
      return c.json({ error: 'callbackUrl must match one of this deployment’s configured CORS origins' }, 400);
    }

    const order = await getOrderById(ctx.db, orderId);
    if (!order) return c.json({ error: 'Order not found' }, 404);
    if (order.status !== 'pending') {
      return c.json({ error: `Cannot initialize payment for an order with status '${order.status}'` }, 400);
    }

    const reference = crypto.randomUUID();
    let initialized;
    try {
      initialized = await ctx.payments.initializeTransaction({
        amount: order.totalAmount,
        currency: order.currency,
        email: order.customerEmail,
        reference,
        callbackUrl,
      });
    } catch (err) {
      ctx.logger.error('Paystack initialize-transaction failed', { orderId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: 'The payment provider returned an error — please try again' }, 502);
    }

    // Recorded as 'pending' the moment Paystack hands back a reference, before the customer has
    // even reached Paystack's own page — this is what lets a later webhook or verify call for
    // THIS exact reference resolve correctly, even if the customer abandons it and initializes a
    // second, different reference afterward (repository/payments.ts's own comment has the full
    // reasoning for tracking every issued reference rather than only the order's latest).
    await initializePaymentAttempt(ctx.db, { orderId, reference: initialized.reference });

    return c.json({ authorizationUrl: initialized.authorizationUrl, reference: initialized.reference }, 200);
  },
);

const verifyQuerySchema = z.object({ reference: z.string().min(1) });
const verifyResponseSchema = z.object({
  orderStatus: z.enum(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']),
  paid: z.boolean(),
});

paymentsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/orders/{orderId}/verify',
    tags: ['Commerce Payments'],
    summary: 'Server-side verify a payment reference and transition the order to paid if it genuinely succeeded',
    request: { params: orderIdParamSchema, query: verifyQuerySchema },
    responses: {
      200: { description: 'The order’s current, authoritative status.', content: { 'application/json': { schema: verifyResponseSchema } } },
      400: { description: 'The reference does not belong to this order.', content: { 'application/json': { schema: errorSchema } } },
      404: { description: 'No order with that id.', content: { 'application/json': { schema: errorSchema } } },
      409: { description: 'The provider confirmed payment, but for a different amount/currency than this order expects.', content: { 'application/json': { schema: errorSchema } } },
      502: { description: 'The payment provider itself returned an error, or an unexpected reference.', content: { 'application/json': { schema: errorSchema } } },
      503: { description: 'Payments are not configured for this deployment.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    if (!ctx.payments.configured) return c.json({ error: 'Payments are not configured for this deployment' }, 503);

    const { orderId } = c.req.valid('param');
    const { reference } = c.req.valid('query');

    const order = await getOrderById(ctx.db, orderId);
    if (!order) return c.json({ error: 'Order not found' }, 404);

    // This reference must be one THIS order's own initialize call actually issued — checked
    // against the payment-attempt ledger, not merely "well-formed," so a reference belonging to a
    // different order (or none at all) can never be used to probe or affect this one.
    const attempt = await getPaymentAttempt(ctx.db, reference);
    if (!attempt || attempt.orderId !== orderId) {
      return c.json({ error: 'That reference does not belong to this order' }, 400);
    }

    // Never trust the browser having merely reached this callback as proof of payment — always
    // re-derive the outcome from Paystack's own server-side verify API, whether this is the
    // first call for this reference or a repeat (e.g. the customer refreshed the return page).
    if (attempt.status === 'pending') {
      let verified;
      try {
        verified = await ctx.payments.verifyTransaction(reference);
      } catch (err) {
        ctx.logger.error('Paystack verify-transaction failed', { orderId, reference, error: err instanceof Error ? err.message : String(err) });
        return c.json({ error: 'The payment provider returned an error — please try again' }, 502);
      }
      if (verified.reference !== reference) {
        return c.json({ error: 'Reference mismatch from payment provider' }, 502);
      }

      const settled = await settlePayment(ctx, order, {
        reference,
        status: verified.status === 'success' ? 'success' : 'failed',
        amount: verified.amount,
        currency: verified.currency,
        raw: verified.raw,
      });
      if (settled.outcome === 'mismatch') {
        return c.json({ error: 'Payment amount/currency does not match the order' }, 409);
      }
    }

    const current = await getOrderById(ctx.db, orderId);
    return c.json({ orderStatus: current!.status, paid: current!.status !== 'pending' }, 200);
  },
);

// Not `.openapi()` — Paystack's webhook payload is provider-defined, not something this
// deployment's own Zod schema validates (matching Core's own precedent for media upload/form
// submission: routes whose body doesn't fit a static request schema stay outside .openapi()'s
// validation entirely, per docs/PLUGINS.md/apps/api's own convention). Reads the body as raw text
// (not JSON) specifically because signature verification needs the exact bytes Paystack signed —
// re-serializing a parsed object could produce different bytes (key order, whitespace) and break
// verification.
paymentsRoutes.post('/webhook', async (c) => {
  const ctx = c.get('pluginContext');
  if (!ctx.payments.configured) return c.json({ error: 'Payments are not configured for this deployment' }, 503);

  const rawBody = await c.req.text();
  const signature = c.req.header('x-paystack-signature');
  const valid = await ctx.payments.verifyWebhookSignature(rawBody, signature);
  if (!valid) {
    return c.json({ error: 'Invalid signature' }, 400);
  }

  let event: { event?: string; data?: { reference?: string; amount?: number; currency?: string; status?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const reference = event.data?.reference;
  if (event.event !== 'charge.success' || !reference) {
    // Not an event this handler acts on (e.g. charge.failed, or a future event type) — 200
    // anyway so Paystack doesn't keep retrying a delivery this deployment deliberately ignores.
    return c.json({ received: true }, 200);
  }

  const attempt = await getPaymentAttempt(ctx.db, reference);
  if (!attempt) {
    ctx.logger.warn('Paystack webhook for unknown reference', { reference });
    return c.json({ received: true }, 200);
  }

  const order = await getOrderById(ctx.db, attempt.orderId);
  if (!order) {
    ctx.logger.error('Paystack webhook references an order that no longer exists', { reference, orderId: attempt.orderId });
    return c.json({ received: true }, 200);
  }

  await settlePayment(ctx, order, {
    reference,
    status: 'success',
    amount: event.data!.amount ?? -1,
    currency: event.data!.currency ?? '',
    raw: event,
  });

  return c.json({ received: true }, 200);
});
