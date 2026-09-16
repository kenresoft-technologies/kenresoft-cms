import { and, count, eq, installationBootstrap, isNull, user } from '@kenresoft-cms/database';
import type { Database } from '@kenresoft-cms/database';

const SINGLETON_ID = 'singleton';

export async function hasAnyUser(db: Database): Promise<boolean> {
  const [row] = await db.select({ count: count() }).from(user);
  return (row?.count ?? 0) > 0;
}

export function getPendingBootstrapToken(db: Database) {
  return db.query.installationBootstrap.findFirst({
    where: (row, { eq: eqFn, and: andFn, isNull: isNullFn }) =>
      andFn(eqFn(row.id, SINGLETON_ID), isNullFn(row.usedAt)),
  });
}

// Upserts the singleton row — a new /bootstrap/request call while a still-valid, unused token
// already exists is a no-op at the route layer (getPendingBootstrapToken is checked first), so
// this only ever actually replaces a row that's expired or already used.
export async function claimBootstrapToken(db: Database, tokenHash: string, expiresAt: Date): Promise<void> {
  await db
    .insert(installationBootstrap)
    .values({ id: SINGLETON_ID, tokenHash, expiresAt, usedAt: null })
    .onConflictDoUpdate({
      target: installationBootstrap.id,
      set: { tokenHash, expiresAt, usedAt: null },
    });
}

// Single-use: a conditional UPDATE keyed on the row still being unused, so two concurrent
// redemptions of the same token can't both succeed — the loser's update matches zero rows.
export async function consumeBootstrapToken(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .update(installationBootstrap)
    .set({ usedAt: new Date() })
    .where(and(eq(installationBootstrap.id, id), isNull(installationBootstrap.usedAt)))
    .returning();
  return rows.length > 0;
}
