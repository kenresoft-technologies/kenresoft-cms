import { and, count, desc, eq, inArray, ne, pluginCommerceCustomerProfiles, session, user } from '@kenresoft-cms/database';
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
  // Derived from a plugin_commerce_customer_profiles row existing for this user id — never a
  // stored column, so this stays accurate even if Commerce is later disabled/uninstalled and
  // says nothing about whether Commerce is currently enabled, only whether this identity has
  // ever been used as a storefront customer (role 'none' or otherwise — nothing stops a
  // promoted CMS staff member's account from having placed an order earlier).
  isCommerceCustomer: boolean;
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
// small (single-site deployment) — cheaper to fetch every table and reduce in JS than to fight
// the SQL for it. No pagination: this stays the one deliberately unbounded admin list in the
// codebase (like content types), consistent with this CMS's single-site-per-deployment scale —
// revisit with real pagination only if a real deployment's account count makes that necessary,
// not speculatively.
//
// Lists every account with access to this deployment — website users (role 'none') and CMS
// staff alike, one unified directory per the Core Users design (docs/ARCHITECTURE.md §10) —
// distinguished by `role` ('none' vs. a real CMS role) and `isCommerceCustomer` (derived below),
// not by two separate lists. This used to filter down to CMS roles only; broadened so the Users
// page can be the account directory for every identity this deployment's better-auth table
// holds, matching plugin-ecommerce's own "a customer is a plain Core user row" design.
export async function listUsersWithLastActive(db: Database, viewer: UserViewer): Promise<UserWithLastActive[]> {
  const visibleCmsRoles = canSeeOwner(viewer) ? USER_ROLES : USER_ROLES.filter((role) => role !== 'owner');
  const roles = [...visibleCmsRoles, 'none'];
  const [users, sessions, customerProfiles] = await Promise.all([
    db.query.user.findMany({ where: inArray(user.role, roles), orderBy: [desc(user.createdAt)] }),
    db.select({ userId: session.userId, updatedAt: session.updatedAt }).from(session),
    db.select({ userId: pluginCommerceCustomerProfiles.userId }).from(pluginCommerceCustomerProfiles),
  ]);

  const lastActiveByUser = new Map<string, Date>();
  for (const row of sessions) {
    const existing = lastActiveByUser.get(row.userId);
    if (!existing || row.updatedAt > existing) {
      lastActiveByUser.set(row.userId, row.updatedAt);
    }
  }
  const customerUserIds = new Set(customerProfiles.map((row) => row.userId));

  return users.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    disabled: row.disabled,
    emailVerified: row.emailVerified,
    developerToolsAccess: row.developerToolsAccess,
    isCommerceCustomer: customerUserIds.has(row.id),
    createdAt: row.createdAt,
    lastActiveAt: lastActiveByUser.get(row.id) ?? null,
  }));
}

// Used by the single-user write routes (role/disabled/developer-tools-access changes) so their
// response's isCommerceCustomer stays truthful without re-running the full list query.
export async function isUserCommerceCustomer(db: Database, userId: string): Promise<boolean> {
  const row = await db.query.pluginCommerceCustomerProfiles.findFirst({
    where: eq(pluginCommerceCustomerProfiles.userId, userId),
    columns: { userId: true },
  });
  return row !== undefined;
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
