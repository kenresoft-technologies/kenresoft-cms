import { and, count, desc, eq, inArray, ne, session, user } from '@kenresoft-cms/database';
import { USER_ROLES } from '@kenresoft-cms/contracts';
import type { Database } from '@kenresoft-cms/database';
import type { AccountRole } from '@kenresoft-cms/contracts';

export interface UserWithLastActive {
  id: string;
  name: string;
  email: string;
  role: string;
  disabled: boolean;
  emailVerified: boolean;
  developerToolsAccess: boolean;
  createdAt: Date;
  lastActiveAt: Date | null;
}

// Who is asking — only the Owner may ever see or address the Owner account. Everyone else
// (Admin, Editor, Viewer — deliberately NOT ranked against each other here) gets the Owner
// filtered out of every list and a plain "not found" on any direct lookup, so the Owner can't be
// discovered through search, pagination, a guessed id, or a different error code.
export interface UserViewer {
  role: string;
}

function canSeeOwner(viewer: UserViewer): boolean {
  return viewer.role === 'owner';
}

// D1's drizzle query builder makes a groupBy+max join awkward, and the user count here is
// small (single-site admin roster) — cheaper to fetch both tables and reduce in JS than to
// fight the SQL for it.
//
// Lists CMS staff only (real CMS roles) — normal website users (role 'none', e.g. Commerce
// customers) can number in the thousands and are managed by whatever feature owns them, not this
// staff roster.
export async function listUsersWithLastActive(db: Database, viewer: UserViewer): Promise<UserWithLastActive[]> {
  const roles = canSeeOwner(viewer) ? [...USER_ROLES] : USER_ROLES.filter((role) => role !== 'owner');
  const [users, sessions] = await Promise.all([
    db.query.user.findMany({ where: inArray(user.role, roles), orderBy: [desc(user.createdAt)] }),
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
    disabled: row.disabled,
    emailVerified: row.emailVerified,
    developerToolsAccess: row.developerToolsAccess,
    createdAt: row.createdAt,
    lastActiveAt: lastActiveByUser.get(row.id) ?? null,
  }));
}

export function getUserById(db: Database, id: string) {
  return db.query.user.findFirst({ where: eq(user.id, id) });
}

// getUserById, but as seen by `viewer`: an Owner target is invisible (undefined — callers 404)
// to anyone who isn't the Owner. Every user-addressed admin route uses this, never the raw lookup.
export async function getUserVisibleTo(db: Database, id: string, viewer: UserViewer) {
  const target = await getUserById(db, id);
  if (target?.role === 'owner' && !canSeeOwner(viewer)) return undefined;
  return target;
}

export function getUserByEmail(db: Database, email: string) {
  return db.query.user.findFirst({ where: eq(user.email, email) });
}

// "Guardian" = owner or admin — either can manage users, so either is enough to keep the
// deployment manageable. Generalizes the old admin-only count: an owner already satisfies
// every requireRole('admin') check via ROLE_RANK, so a deployment with one owner and zero
// admins is not actually locked out, and demoting/removing its last admin should be allowed.
// `excluding` lets a caller ask "if I removed this specific row, would anyone still be left?"
// without a separate before/after count.
export async function countGuardians(db: Database, options?: { excluding?: string }): Promise<number> {
  const conditions = [inArray(user.role, ['owner', 'admin'])];
  if (options?.excluding) conditions.push(ne(user.id, options.excluding));
  const [row] = await db.select({ count: count() }).from(user).where(and(...conditions));
  return row?.count ?? 0;
}

// The un-awaited query builder, exported separately so ownership transfer
// (apps/api/src/routes/admin/security.ts) can pass both role updates to db.batch() as one
// atomic D1 batch — two independent awaited statements would leave a real window where the
// first succeeds and the second fails (network blip, the target row changing concurrently),
// landing the deployment with zero owners despite this being described as a swap.
export function updateUserRoleQuery(db: Database, id: string, role: AccountRole) {
  return db.update(user).set({ role }).where(eq(user.id, id)).returning();
}

export async function updateUserRole(db: Database, id: string, role: AccountRole) {
  const [row] = await updateUserRoleQuery(db, id, role);
  return row!;
}

export async function updateUserDisabled(db: Database, id: string, disabled: boolean) {
  const [row] = await db.update(user).set({ disabled }).where(eq(user.id, id)).returning();
  return row!;
}

export async function updateUserDeveloperToolsAccess(db: Database, id: string, developerToolsAccess: boolean) {
  const [row] = await db.update(user).set({ developerToolsAccess }).where(eq(user.id, id)).returning();
  return row!;
}

// session/account both cascade-delete on user.id (packages/database/schema/auth.ts) — no
// manual cleanup needed. entries.createdBy/entry_revisions.createdBy set null instead, so a
// deleted user's past work stays attributed by nothing rather than disappearing.
export async function deleteUser(db: Database, id: string): Promise<void> {
  await db.delete(user).where(eq(user.id, id));
}
