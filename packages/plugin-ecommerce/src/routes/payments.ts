import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicContext, PluginPublicVariables, VerifyPaymentResult } from '@kenresoft-cms/plugin-sdk';
import type { PluginCommerceOrder, PluginCommerceOrderPayment } from '@kenresoft-cms/database';

import { getOrderById } from '../repository/orders';
import {
  abandonPaymentAttempt,
  claimPendingPaymentAttempt,
  getPaymentAttempt,
  reclaimStaleUnauthorizedAttempt,
  resolvePaymentAttempt,
  setPaymentAttemptAuthorizationUrl,
} from '../repository/payments';

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

// Paystack's own terminal outcomes. Everything else ('pending', 'ongoing', 'processing',
// 'queued', 'reversed', 'other') is genuinely still in flight (or not something this deployment
// resolves automatically) and must never be treated as a failure — see
// apps/api/src/lib/payments/types.ts's own comment on why this distinction exists at all.
const TERMINAL_FAILURE_STATUSES: ReadonlySet<VerifyPaymentResult['status']> = new Set(['failed', 'abandoned']);

// Mirrors repository/payments.ts's own STALE_UNAUTHORIZED_CLAIM_MS — the DB-side reclaim is the
// actual authority (a fresh claim genuinely younger than this is rejected there regardless of what
// this route computes), this local check just avoids bothering Paystack with a verify call for a
// claim that's still well within its normal in-flight window.
const STALE_UNAUTHORIZED_CLAIM_MS = 30_000;

type SettleOutcome = 'success' | 'failed' | 'mismatch' | 'already_resolved' | 'unknown_reference' | 'succeeded_but_order_not_pending';

// Shared by the initialize (duplicate-check), verify, and webhook routes below — all three
// eventually reduce to "here is a {reference, status: success|failed, amount, currency} tuple
// from the provider (an API response for verify/initialize, a signed payload for the webhook);
// reconcile it against the payment-attempt ledger and, if it's a genuine still-pending success,
// transition the order." resolvePaymentAttempt's own conditional UPDATE is what makes calling
// this twice for the same reference (a retried webhook delivery, a duplicate verify request
// racing it) safe — see repository/payments.ts. Only ever called with a TERMINAL status
// ('success' or 'failed') — a non-terminal Paystack status must never reach this function at all,
// since resolving it either way would be premature.
async function settlePayment(
  ctx: PluginPublicContext,
  order: PluginCommerceOrder,
  data: { reference: string; status: 'success' | 'failed'; amount: number; currency: string; raw: unknown },
): Promise<SettleOutcome> {
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
    return 'mismatch';
  }

  const result = await resolvePaymentAttempt(ctx.db, data);
  if (!result.ok) return 'unknown_reference';
  if (result.alreadyResolved) return 'already_resolved';

  if (data.status === 'success' && !result.orderTransitionedToPaid) {
    // The payment genuinely succeeded at Paystack, but by the time it resolved here the order
    // was no longer 'pending' (e.g. an admin cancelled it in the meantime, or it was already
    // resolved to paid by another concurrent call — resolvePaymentAttempt's own atomic guard
    // already prevented a double-transition either way). The order's CMS status is NEVER
    // silently overwritten by an async payment confirmation arriving after the fact — an
    // explicit staff/admin action or an earlier resolution always wins. This is the authoritative
    // policy for the cancellation-vs-payment race: if the order is no longer pending, real money
    // has still moved and this deployment cannot silently pretend otherwise, so it's logged
    // loudly for manual reconciliation (a refund through Paystack's own dashboard, since
    // provider-backed refunds aren't implemented yet — docs/PLUGINS.md's Commerce section) rather
    // than either reopening the order automatically (which could re-oversell stock already given
    // back at cancel time) or silently dropping the fact that a charge succeeded.
    ctx.logger.error('Commerce payment succeeded for an order that is no longer pending — needs manual reconciliation/refund', {
      orderId: order.id,
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      orderStatus: order.status,
    });
    return 'succeeded_but_order_not_pending';
  }

  return data.status;
}

const initializeSchema = z.object({ callbackUrl: z.string().url() });
const initializeResponseSchema = z.object({ authorizationUrl: z.string(), reference: z.string() });

paymentsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/orders/{orderId}/initialize',
    tags: ['Commerce Payments'],
    summary: 'Initialize a Paystack transaction for a pending order (idempotent — reuses an already-open attempt rather than starting a second one)',
    request: { params: orderIdParamSchema, body: { content: { 'application/json': { schema: initializeSchema } } } },
    responses: {
      200: { description: 'Redirect the browser to authorizationUrl.', content: { 'application/json': { schema: initializeResponseSchema } } },
      400: { description: 'An invalid callbackUrl, or the order is not in a payable state.', content: { 'application/json': { schema: errorSchema } } },
      404: { description: 'No order with that id.', content: { 'application/json': { schema: errorSchema } } },
      409: { description: 'The provider confirmed a prior attempt for this order already succeeded, for a different amount/currency than expected.', content: { 'application/json': { schema: errorSchema } } },
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

    // Calls Paystack for an ALREADY-CLAIMED reference (claimPendingPaymentAttempt must have
    // succeeded before this is ever called) and records the result. Split out from the claim
    // itself so both "this is the first attempt" and "the prior attempt just failed, claim a
    // fresh one" can share the exact same call-and-record logic.
    const initializeWithClaimedReference = async (reference: string) => {
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
        // Free the claimed slot — a transient provider error must not permanently block this
        // order from ever initializing payment again (repository/payments.ts's own comment).
        await abandonPaymentAttempt(ctx.db, reference);
        return c.json({ error: 'The payment provider returned an error — please try again' }, 502);
      }

      // Recorded the moment Paystack hands back a real session, before the customer has even
      // reached its page — this is what lets a later webhook or verify call for THIS exact
      // reference resolve correctly, even if the customer abandons it and a later call
      // initializes a second, different reference afterward. Conditional: if this exact claim
      // was reclaimed (repository/payments.ts's reclaimStaleUnauthorizedAttempt) while this
      // request was still waiting on Paystack — a real possibility for a genuinely slow provider
      // call, not just a crashed request — persisted returns false and this reference must not
      // be handed to the caller as if it were still the order's active checkout session. The row
      // itself is untouched otherwise (still 'pending', reclaimedAt set) — if Paystack later
      // reports a real success for it, resolvePaymentAttempt still resolves the order correctly;
      // this only ever affects whether THIS response exposes the URL, never whether the money
      // itself can still be collected.
      const persisted = await setPaymentAttemptAuthorizationUrl(ctx.db, reference, initialized.authorizationUrl);
      if (!persisted) {
        ctx.logger.warn('Paystack initialization completed after this payment claim was reclaimed by a newer attempt — not exposing its authorization URL', {
          orderId,
          reference,
        });
        return c.json({ error: 'Payment initialization was superseded by a newer attempt — please retry' }, 409);
      }

      return c.json({ authorizationUrl: initialized.authorizationUrl, reference }, 200);
    };

    // The atomic claim-then-call-Paystack sequence (issue 1 of the Phase 2d payments review): the
    // reference is generated and reserved in the DB via claimPendingPaymentAttempt — which can
    // only ever let ONE of two truly concurrent callers win, enforced by a real partial unique
    // index (packages/database/schema/plugins/commerce.ts) — BEFORE Paystack is ever called. A
    // plain "check for an existing attempt, then insert one" has a genuine TOCTOU race: two
    // concurrent requests can both observe no pending attempt before either has inserted one.
    const firstClaim = await claimPendingPaymentAttempt(ctx.db, orderId);
    if (firstClaim.claimed) {
      return initializeWithClaimedReference(firstClaim.reference);
    }

    // Lost the claim — an attempt already exists, either from this same buyer's own recent retry
    // or a genuinely concurrent request. Inspect it with Paystack rather than assuming anything.
    const existing: PluginCommerceOrderPayment = firstClaim.existing;
    if (!existing.authorizationUrl) {
      const claimAgeMs = Date.now() - existing.createdAt.getTime();
      if (claimAgeMs < STALE_UNAUTHORIZED_CLAIM_MS) {
        // Still genuinely in flight — a concurrent request claimed the slot moments ago and
        // hasn't heard back from Paystack (or persisted the result) yet. Nothing to recover.
        return c.json({ error: 'Payment initialization for this order is already in progress — please retry shortly' }, 409);
      }

      // Stale: the claiming request looks abandoned (a crash, a kill, or simply still running
      // slowly) — without recovery this would block the order from ever initializing payment
      // again. Check with Paystack directly before assuming nothing happened there:
      // authorizationUrl was never persisted, so this deployment never handed a checkout link to
      // a customer for this exact reference (making a genuine success here exceedingly unlikely),
      // but the check is cheap and removes any doubt rather than relying on that reasoning alone.
      // Reclaiming below is non-destructive either way — see reclaimStaleUnauthorizedAttempt's own
      // comment: it never marks this row 'failed', so if the original request is simply slow
      // rather than dead and later calls back into resolvePaymentAttempt with a real outcome,
      // that still resolves correctly regardless of what happens here.
      let recheck;
      try {
        recheck = await ctx.payments.verifyTransaction(existing.reference);
      } catch (err) {
        // Most likely: Paystack has never heard of this reference either (the claiming request
        // died before ever calling initializeTransaction) — nothing to recover from Paystack's
        // side, proceed to reclaim the stale row below.
        ctx.logger.warn('Paystack re-verify failed while recovering a stale, unauthorized payment claim', {
          orderId,
          reference: existing.reference,
          error: err instanceof Error ? err.message : String(err),
        });
        recheck = undefined;
      }

      if (recheck?.status === 'success') {
        const outcome = await settlePayment(ctx, order, { reference: existing.reference, status: 'success', amount: recheck.amount, currency: recheck.currency, raw: recheck.raw });
        if (outcome === 'mismatch') {
          return c.json({ error: 'A prior payment attempt for this order succeeded, but for an amount/currency that does not match' }, 409);
        }
        return c.json({ error: 'This order has already been paid' }, 400);
      }

      const reclaimed = await reclaimStaleUnauthorizedAttempt(ctx.db, existing.reference);
      if (!reclaimed) {
        // Lost a race to reclaim this exact row (another request's recovery attempt, or its own
        // retry, beat this one to it) — whatever happened, ask the caller to retry shortly rather
        // than assuming this request now owns anything.
        return c.json({ error: 'Payment initialization for this order is already in progress — please retry shortly' }, 409);
      }

      const freshClaim = await claimPendingPaymentAttempt(ctx.db, orderId);
      if (!freshClaim.claimed) {
        return c.json({ error: 'Payment initialization for this order is already in progress — please retry shortly' }, 409);
      }
      return initializeWithClaimedReference(freshClaim.reference);
    }

    let recheck;
    try {
      recheck = await ctx.payments.verifyTransaction(existing.reference);
    } catch (err) {
      // A transient provider error while merely re-checking must not force a second, duplicate
      // reference just because one status check failed — reuse the session already on file.
      ctx.logger.warn('Paystack re-verify failed while checking for a duplicate payment initialization; reusing the existing attempt', {
        orderId,
        reference: existing.reference,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ authorizationUrl: existing.authorizationUrl, reference: existing.reference }, 200);
    }

    if (recheck.status === 'success') {
      const outcome = await settlePayment(ctx, order, { reference: existing.reference, status: 'success', amount: recheck.amount, currency: recheck.currency, raw: recheck.raw });
      if (outcome === 'mismatch') {
        return c.json({ error: 'A prior payment attempt for this order succeeded, but for an amount/currency that does not match' }, 409);
      }
      return c.json({ error: 'This order has already been paid' }, 400);
    }

    if (TERMINAL_FAILURE_STATUSES.has(recheck.status)) {
      const result = await resolvePaymentAttempt(ctx.db, { reference: existing.reference, status: 'failed', amount: recheck.amount, currency: recheck.currency, raw: recheck.raw });
      if (result.ok && !result.alreadyResolved) {
        // This request won the resolve race — the one-pending-per-order slot is now free, so
        // it's safe to claim and issue a real, fresh reference in the same round trip. The claim
        // here goes through the exact same atomic path as the first attempt above; if a THIRD
        // concurrent request somehow also reaches this point and wins ITS OWN resolve race
        // first, this claim would lose to it — the response below already covers "lost the
        // claim" as a 409 retry-shortly.
        const freshClaim = await claimPendingPaymentAttempt(ctx.db, orderId);
        if (!freshClaim.claimed) {
          return c.json({ error: 'Payment initialization for this order is already in progress — please retry shortly' }, 409);
        }
        return initializeWithClaimedReference(freshClaim.reference);
      }
      // Someone else already resolved it a moment ago (or it's already gone) — don't also race
      // to claim a new slot; ask the client to retry, by which point the winner's fresh
      // reference (if any) will already exist to be found on the next call.
      return c.json({ error: 'The previous payment attempt for this order just failed — please retry' }, 409);
    }

    // Still non-terminal at Paystack (or an ambiguous status this deployment doesn't act on
    // automatically) — reuse the existing, still-potentially-payable session.
    return c.json({ authorizationUrl: existing.authorizationUrl, reference: existing.reference }, 200);
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

      if (verified.status === 'success') {
        const outcome = await settlePayment(ctx, order, { reference, status: 'success', amount: verified.amount, currency: verified.currency, raw: verified.raw });
        if (outcome === 'mismatch') {
          return c.json({ error: 'Payment amount/currency does not match the order' }, 409);
        }
      } else if (TERMINAL_FAILURE_STATUSES.has(verified.status)) {
        await settlePayment(ctx, order, { reference, status: 'failed', amount: verified.amount, currency: verified.currency, raw: verified.raw });
      } else {
        // 'pending'/'ongoing'/'processing'/'queued' (still in flight at Paystack), 'reversed', or
        // 'other' — none of these are terminal outcomes this deployment resolves automatically;
        // the attempt stays 'pending' in the ledger for a later verify/webhook call to resolve
        // correctly, rather than guessing at an outcome Paystack hasn't actually reached yet.
        ctx.logger.info('Paystack transaction not yet terminal', { orderId, reference, status: verified.status });
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
