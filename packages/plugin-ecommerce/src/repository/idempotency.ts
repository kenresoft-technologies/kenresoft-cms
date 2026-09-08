import { eq, pluginCommerceIdempotencyKeys } from '@kenresoft-cms/database';
import type { Database } from '@kenresoft-cms/database';

export type IdempotencyClaim =
  | { state: 'claimed' }
  | { state: 'in_progress' }
  | { state: 'completed'; status: number; body: unknown };

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
// specific constraint-violation error shape, which nothing else in this codebase does.
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
  if (!existing || existing.responseStatus === null) {
    return { state: 'in_progress' };
  }
  return { state: 'completed', status: existing.responseStatus, body: existing.responseBody };
}

export async function completeIdempotencyKey(db: Database, scope: string, key: string, status: number, body: unknown): Promise<void> {
  await db
    .update(pluginCommerceIdempotencyKeys)
    .set({ responseStatus: status, responseBody: body })
    .where(eq(pluginCommerceIdempotencyKeys.id, compoundKey(scope, key)));
}
