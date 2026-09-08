import { and, asc, desc, eq, isNull, lt, pluginCommerceOrderPayments, pluginCommerceOrders } from '@kenresoft-cms/database';
import type { Database, PluginCommerceOrderPayment } from '@kenresoft-cms/database';

export type ClaimPendingPaymentAttemptResult =
  | { claimed: true; reference: string }
  | { claimed: false; existing: PluginCommerceOrderPayment };

// The atomic half of preventing duplicate payment initialization (routes/payments.ts) — a plain
// check-then-insert (look for a pending attempt, then insert one if none exists) has a genuine
// TOCTOU race: two concurrent POST /orders/{id}/initialize calls can both observe no pending
// attempt before either has inserted one, and both proceed to call Paystack, producing two
// independently chargeable references. This closes that race by reserving the DB row FIRST — the
// reference is generated here, before any call to Paystack — via the same partial-unique-index-
// plus-onConflictDoNothing idiom this codebase already uses (plugin_commerce_carts' one-cart-per-
// customer constraint): only one of two truly concurrent INSERTs can ever win, because
// `plugin_commerce_order_payments_one_pending_per_order_idx` allows at most one 'pending' row per
// order. The loser gets back the row that DID win, to inspect and decide from (routes/payments.ts
// re-verifies it with Paystack rather than assuming anything about its state).
export async function claimPendingPaymentAttempt(db: Database, orderId: string): Promise<ClaimPendingPaymentAttemptResult> {
  const reference = crypto.randomUUID();
  const [claimed] = await db
    .insert(pluginCommerceOrderPayments)
    .values({ orderId, provider: 'paystack', reference, status: 'pending' })
    .onConflictDoNothing()
    .returning();
  if (claimed) {
    return { claimed: true, reference };
  }

  const existing = await getPendingPaymentAttemptForOrder(db, orderId);
  if (!existing) {
    // Extremely unlikely (the conflict implies a 'pending' row exists) — a resolution could have
    // landed in the gap between the failed insert and this read. Treat it the same as a genuine
    // claim failure so the caller retries rather than assuming success it doesn't actually have.
    throw new Error(`claimPendingPaymentAttempt: insert conflicted for order ${orderId} but no pending attempt was found`);
  }
  return { claimed: false, existing };
}

// Called once the claimed reference has actually been initialized with Paystack — a plain UPDATE
// by reference is safe here (no conflict possible): the caller that claimed this exact reference
// via claimPendingPaymentAttempt is its only owner until it resolves.
export async function setPaymentAttemptAuthorizationUrl(db: Database, reference: string, authorizationUrl: string): Promise<void> {
  await db.update(pluginCommerceOrderPayments).set({ authorizationUrl }).where(eq(pluginCommerceOrderPayments.reference, reference));
}

// Frees up the one-pending-attempt-per-order slot after a provider error during initialize (the
// claim succeeded, but the actual Paystack call then failed) — without this, a transient provider
// error would otherwise permanently block this order from ever initializing payment again, since
// the claimed 'pending' row would linger with no authorizationUrl and nothing left to resolve it.
export async function abandonPaymentAttempt(db: Database, reference: string): Promise<void> {
  await db
    .update(pluginCommerceOrderPayments)
    .set({ status: 'failed', resolvedAt: new Date() })
    .where(and(eq(pluginCommerceOrderPayments.reference, reference), eq(pluginCommerceOrderPayments.status, 'pending')));
}

// Recovers a claim that was reserved (claimPendingPaymentAttempt) but never got as far as
// recording an authorizationUrl — the window between reserving the row and either a crash/kill of
// the Worker or a still-in-flight call to Paystack. Without this, such a row blocks
// POST /orders/{id}/initialize forever: claimPendingPaymentAttempt always loses the race to it,
// and routes/payments.ts's own "no authorizationUrl yet" branch would otherwise always 409
// indefinitely. Deliberately never invalidates a row that already has an authorizationUrl — that
// case means Paystack was actually reached and this deployment DID hand a checkout session id
// back in a request that returned successfully, which routes/payments.ts's separate
// re-verify-with-Paystack path (not this function) already covers correctly.
//
// Safe to reclaim without asking Paystack first: authorizationUrl is only ever persisted, and
// only ever returned to a caller, in the same request that set it — if it was never persisted,
// this deployment never handed a checkout link to anyone, so nobody could have completed payment
// through this specific reference regardless of what Paystack's own session state for it might
// be. routes/payments.ts still checks with Paystack directly before calling this, purely as an
// extra, cheap safety net (not because it's required for correctness here).
//
// The same conditional-update-plus-check-returned-rows idiom as resolvePaymentAttempt/
// claimIdempotencyKey — only one of two concurrent reclaim attempts for the same reference can
// ever succeed.
const STALE_UNAUTHORIZED_CLAIM_MS = 30_000;

export async function reclaimStaleUnauthorizedAttempt(db: Database, reference: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - STALE_UNAUTHORIZED_CLAIM_MS);
  const [reclaimed] = await db
    .update(pluginCommerceOrderPayments)
    .set({ status: 'failed', resolvedAt: new Date() })
    .where(
      and(
        eq(pluginCommerceOrderPayments.reference, reference),
        eq(pluginCommerceOrderPayments.status, 'pending'),
        isNull(pluginCommerceOrderPayments.authorizationUrl),
        lt(pluginCommerceOrderPayments.createdAt, cutoff),
      ),
    )
    .returning();
  return Boolean(reclaimed);
}

export function getPaymentAttempt(db: Database, reference: string): Promise<PluginCommerceOrderPayment | undefined> {
  return db.query.pluginCommerceOrderPayments.findFirst({ where: eq(pluginCommerceOrderPayments.reference, reference) });
}

// The most recent still-open payment attempt for an order, if any — what routes/payments.ts's
// initialize route checks before ever calling Paystack again, so a repeated
// POST /orders/{id}/initialize can't create multiple live references (and therefore multiple
// chargeable checkout sessions) for the same order. `desc(createdAt)` + a single row is
// defensive: normal flow only ever has one 'pending' attempt open per order at a time (a prior
// one is always resolved to success/failed before a fresh one is created), but this stays correct
// even if that invariant is ever violated.
export function getPendingPaymentAttemptForOrder(db: Database, orderId: string): Promise<PluginCommerceOrderPayment | undefined> {
  return db.query.pluginCommerceOrderPayments.findFirst({
    where: and(eq(pluginCommerceOrderPayments.orderId, orderId), eq(pluginCommerceOrderPayments.status, 'pending')),
    orderBy: desc(pluginCommerceOrderPayments.createdAt),
  });
}

export function listPaymentAttemptsForOrder(db: Database, orderId: string): Promise<PluginCommerceOrderPayment[]> {
  return db.query.pluginCommerceOrderPayments.findMany({
    where: eq(pluginCommerceOrderPayments.orderId, orderId),
    orderBy: asc(pluginCommerceOrderPayments.createdAt),
  });
}

export type ResolvePaymentAttemptResult =
  | { ok: false; error: 'unknown_reference' }
  | { ok: true; alreadyResolved: true; orderId: string }
  | { ok: true; alreadyResolved: false; orderId: string; orderTransitionedToPaid: boolean };

// The actual idempotency mechanism for payment confirmation (routes/payments.ts calls this from
// both the verify-callback route and the webhook route) — a single conditional
// `UPDATE ... WHERE reference = ? AND status = 'pending' RETURNING *`, the same
// conditional-update-plus-check-returned-rows idiom this codebase already uses for single-use
// tokens (customer-tokens.ts) and stock reservation (createOrder above). A retried webhook
// delivery or a duplicate verify call for an already-resolved reference matches zero rows here —
// safely detected as `alreadyResolved: true` rather than double-recording a payment or
// double-transitioning the order. Only a 'success' resolution ever moves the order to 'paid', and
// only if it's still 'pending' at that moment (guards against a resolution racing an admin
// cancellation, however unlikely) — `orderTransitionedToPaid` reports whether THIS call actually
// performed that transition, distinct from the payment attempt itself resolving successfully, so a
// genuine double-payment for one order (a rare customer error, not solved by this pass — flagged,
// not silently risked) still gets its own payment row recorded even though the second one can't
// also transition an already-paid order.
export async function resolvePaymentAttempt(
  db: Database,
  input: { reference: string; status: 'success' | 'failed'; amount: number; currency: string; raw: unknown },
): Promise<ResolvePaymentAttemptResult> {
  const [resolved] = await db
    .update(pluginCommerceOrderPayments)
    .set({ status: input.status, amount: input.amount, currency: input.currency, rawPayload: input.raw as Record<string, unknown>, resolvedAt: new Date() })
    .where(and(eq(pluginCommerceOrderPayments.reference, input.reference), eq(pluginCommerceOrderPayments.status, 'pending')))
    .returning();

  if (!resolved) {
    const existing = await getPaymentAttempt(db, input.reference);
    if (!existing) return { ok: false, error: 'unknown_reference' };
    return { ok: true, alreadyResolved: true, orderId: existing.orderId };
  }

  let transitioned = false;
  if (input.status === 'success') {
    const [updatedOrder] = await db
      .update(pluginCommerceOrders)
      .set({ status: 'paid', updatedAt: new Date() })
      .where(and(eq(pluginCommerceOrders.id, resolved.orderId), eq(pluginCommerceOrders.status, 'pending')))
      .returning({ id: pluginCommerceOrders.id });
    transitioned = Boolean(updatedOrder);
  }

  return { ok: true, alreadyResolved: false, orderId: resolved.orderId, orderTransitionedToPaid: transitioned };
}
