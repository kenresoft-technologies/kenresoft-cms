import { and, eq, isNull, lt, pluginCommerceIdempotencyKeys } from '@kenresoft-cms/database';
import type { Database } from '@kenresoft-cms/database';

export type IdempotencyClaim =
  | { state: 'claimed' }
  | { state: 'in_progress' }
  | { state: 'completed'; status: number; body: unknown };

// A real checkout request — cart/customer/stock reads, the createOrder batch — should finish well
// within this. If a claimed key is still unresolved after this long, the request that claimed it
// most likely crashed or was killed before ever calling completeIdempotencyKey, and the key would
// otherwise block that value forever. Deliberately generous (checkout is I/O-bound, not
// long-running) rather than tuned tight — a false "still in progress" (409, retry shortly) is
// harmless; reclaiming too early, while the original request is genuinely still running, would
// let two requests process the same key concurrently, which is exactly what this exists to
// prevent.
const STALE_CLAIM_MS = 30_000;

// scope+key are folded into one primary-key string (e.g. "checkout:<uuid>") rather than a
// separate scope column — see packages/database/schema/plugins/commerce.ts's own comment on why
// that's enough for the one endpoint using this today.
function compoundKey(scope: string, key: string): string {
  return `${scope}:${key}`;
}

// Atomically claims (scope, key) for processing. `.onConflictDoNothing()` — not a plain INSERT
// wrapped in try/catch — is what makes this race-safe: only one of two truly concurrent identical
// submissions can ever have its INSERT actually return a row, mirroring this codebase's own
// conditional-write-plus-check-returned-rows idiom (customer-tokens.ts's DELETE...RETURNING,
// cart-items.ts's stock-capped UPDATE...RETURNING) rather than relying on catching a driver-
// specific constraint-violation error shape, which nothing else in this codebase does. A claim
// that's been open longer than STALE_CLAIM_MS with no response recorded is reclaimed the same
// atomic way — see below — rather than left blocking this key forever.
export async function claimIdempotencyKey(db: Database, scope: string, key: string): Promise<IdempotencyClaim> {
  const id = compoundKey(scope, key);

  const [claimed] = await db.insert(pluginCommerceIdempotencyKeys).values({ id }).onConflictDoNothing().returning();
  if (claimed) {
    return { state: 'claimed' };
  }

  // Lost the race (or this is a genuine retry of an earlier request) — the row already exists;
  // its own responseStatus tells us whether that earlier request has actually finished yet.
  const existing = await db.query.pluginCommerceIdempotencyKeys.findFirst({
    where: eq(pluginCommerceIdempotencyKeys.id, id),
  });
  if (!existing) {
    // Only reachable if the row was deleted between the failed insert and this read — nothing
    // else in this codebase ever deletes an idempotency key row, so this is defensive only.
    return { state: 'in_progress' };
  }
  if (existing.responseStatus !== null) {
    return { state: 'completed', status: existing.responseStatus, body: existing.responseBody };
  }

  // Still open per our own record. Try to reclaim it if it's stale: an atomic conditional UPDATE
  // (not a plain overwrite) that bumps createdAt only when it's both still unresolved AND older
  // than the staleness cutoff — the same conditional-write-plus-check-returned-rows idiom as the
  // claim above. Bumping createdAt is itself the reclaim: it's simultaneously "I now own this
  // key" and the guard that stops a second, concurrent reclaimer from also succeeding (their own
  // `createdAt < cutoff` check would already be false against the just-bumped value).
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const [reclaimed] = await db
    .update(pluginCommerceIdempotencyKeys)
    .set({ createdAt: new Date() })
    .where(and(eq(pluginCommerceIdempotencyKeys.id, id), isNull(pluginCommerceIdempotencyKeys.responseStatus), lt(pluginCommerceIdempotencyKeys.createdAt, cutoff)))
    .returning();
  if (reclaimed) {
    return { state: 'claimed' };
  }

  return { state: 'in_progress' };
}

export async function completeIdempotencyKey(db: Database, scope: string, key: string, status: number, body: unknown): Promise<void> {
  await db
    .update(pluginCommerceIdempotencyKeys)
    .set({ responseStatus: status, responseBody: body })
    .where(eq(pluginCommerceIdempotencyKeys.id, compoundKey(scope, key)));
}
