import { count, desc, eq, session, user } from '@kenresoft/database';
import type { Database } from '@kenresoft/database';

export interface UserWithLastActive {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
  lastActiveAt: Date | null;
}

// D1's drizzle query builder makes a groupBy+max join awkward, and the user count here is
// small (single-site admin roster) — cheaper to fetch both tables and reduce in JS than to
// fight the SQL for it.
export async function listUsersWithLastActive(db: Database): Promise<UserWithLastActive[]> {
  const [users, sessions] = await Promise.all([
    db.query.user.findMany({ orderBy: [desc(user.createdAt)] }),
    db.select({ userId: session.userId, updatedAt: session.updatedAt }).from(session),
  ]);

  const lastActiveByUser = new Map<string, Date>();
  for (const row of sessions) {
    const existing = lastActiveByUser.get(row.userId);
    if (!existing || row.updatedAt > existing) {
      lastActiveByUser.set(row.userId, row.updatedAt);
    }
  }

  return users.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
    lastActiveAt: lastActiveByUser.get(row.id) ?? null,
  }));
}

export function getUserById(db: Database, id: string) {
  return db.query.user.findFirst({ where: eq(user.id, id) });
}

export function getUserByEmail(db: Database, email: string) {
  return db.query.user.findFirst({ where: eq(user.email, email) });
}

export async function countAdmins(db: Database): Promise<number> {
  const [row] = await db.select({ count: count() }).from(user).where(eq(user.role, 'admin'));
  return row?.count ?? 0;
}

export async function updateUserRole(db: Database, id: string, role: 'admin' | 'editor' | 'author' | 'viewer') {
  const [row] = await db.update(user).set({ role }).where(eq(user.id, id)).returning();
  return row!;
}

// session/account both cascade-delete on user.id (packages/database/schema/auth.ts) — no
// manual cleanup needed. entries.createdBy/entry_revisions.createdBy set null instead, so a
// deleted user's past work stays attributed by nothing rather than disappearing.
export async function deleteUser(db: Database, id: string): Promise<void> {
  await db.delete(user).where(eq(user.id, id));
}
