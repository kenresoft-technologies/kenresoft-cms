import { and, asc, eq, pluginCommerceOrderPayments, pluginCommerceOrders } from '@kenresoft-cms/database';
import type { Database, PluginCommerceOrderPayment } from '@kenresoft-cms/database';

// Called the moment a Paystack transaction is initialized, before the customer has even reached
// Paystack's page — this is what makes resolvePaymentAttempt's later lookup-by-reference work
// regardless of which reference (first attempt, or a later retry) actually gets paid.
export async function initializePaymentAttempt(db: Database, input: { orderId: string; reference: string }): Promise<void> {
  await db.insert(pluginCommerceOrderPayments).values({
    orderId: input.orderId,
    provider: 'paystack',
    reference: input.reference,
    status: 'pending',
  });
}

export function getPaymentAttempt(db: Database, reference: string): Promise<PluginCommerceOrderPayment | undefined> {
  return db.query.pluginCommerceOrderPayments.findFirst({ where: eq(pluginCommerceOrderPayments.reference, reference) });
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
