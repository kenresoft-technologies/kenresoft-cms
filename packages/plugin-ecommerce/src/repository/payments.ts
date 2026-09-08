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

// Called once the claimed reference has actually been initialized with Paystack — persists the
// URL only while THIS reference is still the order's active, unreclaimed attempt. A plain,
// unconditional UPDATE by reference alone (this function's original shape) assumed the claiming
// caller stays "its only owner until it resolves" — no longer true once stale-claim reclaim
// exists (reclaimStaleUnauthorizedAttempt below): a genuinely slow (not crashed) Paystack call
// can still return successfully after another request has already reclaimed this exact row and
// started a fresh attempt of its own. Returning `false` tells routes/payments.ts that happened,
// so it can avoid handing the caller a URL for a session that's no longer the order's active one.
// Deliberately does NOT touch `status` or `reclaimedAt` on failure — the row itself is left
// exactly as reclaimStaleUnauthorizedAttempt set it, still resolvable later by a real webhook/
// verify call if Paystack genuinely did charge the customer through this reference; only whether
// THIS caller may expose the URL is affected, never whether the money can still be collected.
export async function setPaymentAttemptAuthorizationUrl(db: Database, reference: string, authorizationUrl: string): Promise<boolean> {
  const [updated] = await db
    .update(pluginCommerceOrderPayments)
    .set({ authorizationUrl })
    .where(
      and(
        eq(pluginCommerceOrderPayments.reference, reference),
        eq(pluginCommerceOrderPayments.status, 'pending'),
        isNull(pluginCommerceOrderPayments.reclaimedAt),
      ),
    )
    .returning({ id: pluginCommerceOrderPayments.id });
  return Boolean(updated);
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
// Deliberately does NOT set `status` to 'failed' — a row this old with no authorizationUrl looks
// abandoned, but the original claiming request might simply still be running (a slow Paystack
// call, a GC pause, a loaded runner) and could still legitimately call back into
// resolvePaymentAttempt with a real 'success' or 'failed' outcome after this function runs.
// resolvePaymentAttempt's own conditional UPDATE only ever matches `status = 'pending'`, so
// changing it here would permanently strand a late-but-genuine success: the order would never
// transition to paid even though the customer really was charged. Only `reclaimedAt` is set
// (see its own column comment in packages/database/schema/plugins/commerce.ts) — this frees the
// one-open-attempt-per-order unique index slot for a fresh claim (that index's own WHERE clause
// now excludes reclaimed rows) without disturbing this row's own future resolvability at all.
//
// Safe to reclaim (i.e. free the slot for a new attempt) without asking Paystack first:
// authorizationUrl is only ever persisted, and only ever returned to a caller, in the same
// request that set it — if it was never persisted, this deployment never handed a checkout link
// to anyone, so nobody could have completed payment through this specific reference via the
// browser regardless of what Paystack's own session state for it might be. routes/payments.ts
// still checks with Paystack directly before calling this, purely as an extra, cheap safety net
// (not because it's required for correctness here — that safety net is this function leaving
// `status` alone).
//
// The same conditional-update-plus-check-returned-rows idiom as resolvePaymentAttempt/
// claimIdempotencyKey — only one of two concurrent reclaim attempts for the same reference can
// ever succeed (guarded by `reclaimedAt IS NULL`, so a second call against an already-reclaimed
// row is a safe no-op rather than repeatedly bumping the timestamp).
const STALE_UNAUTHORIZED_CLAIM_MS = 30_000;

export async function reclaimStaleUnauthorizedAttempt(db: Database, reference: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - STALE_UNAUTHORIZED_CLAIM_MS);
  const [reclaimed] = await db
    .update(pluginCommerceOrderPayments)
    .set({ reclaimedAt: new Date() })
    .where(
      and(
        eq(pluginCommerceOrderPayments.reference, reference),
        eq(pluginCommerceOrderPayments.status, 'pending'),
        isNull(pluginCommerceOrderPayments.authorizationUrl),
        isNull(pluginCommerceOrderPayments.reclaimedAt),
        lt(pluginCommerceOrderPayments.createdAt, cutoff),
      ),
    )
    .returning();
  return Boolean(reclaimed);
}

export function getPaymentAttempt(db: Database, reference: string): Promise<PluginCommerceOrderPayment | undefined> {
  return db.query.pluginCommerceOrderPayments.findFirst({ where: eq(pluginCommerceOrderPayments.reference, reference) });
}

// The most recent still-open, still-active payment attempt for an order, if any — what
// routes/payments.ts's initialize route checks before ever calling Paystack again, so a repeated
// POST /orders/{id}/initialize can't create multiple live references (and therefore multiple
// chargeable checkout sessions) for the same order. `reclaimedAt IS NULL` mirrors the partial
// unique index's own WHERE clause exactly (packages/database/schema/plugins/commerce.ts) — a
// reclaimed row is still `status = 'pending'` (deliberately, see reclaimStaleUnauthorizedAttempt's
// own comment) but must never be treated as "the" open attempt for this order once reclaimed, or
// this function and the index it mirrors would disagree about whether a fresh claim is allowed.
// `desc(createdAt)` + a single row is defensive: normal flow only ever has one open attempt per
// order at a time (a prior one is always resolved or reclaimed before a fresh one is created),
// but this stays correct even if that invariant is ever violated.
export function getPendingPaymentAttemptForOrder(db: Database, orderId: string): Promise<PluginCommerceOrderPayment | undefined> {
  return db.query.pluginCommerceOrderPayments.findFirst({
    where: and(
      eq(pluginCommerceOrderPayments.orderId, orderId),
      eq(pluginCommerceOrderPayments.status, 'pending'),
      isNull(pluginCommerceOrderPayments.reclaimedAt),
    ),
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
