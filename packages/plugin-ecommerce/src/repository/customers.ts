import {
  and,
  desc,
  eq,
  like,
  or,
  pluginCommerceCustomerAddresses,
  pluginCommerceCustomerProfiles,
  pluginCommerceOrders,
  session,
  user,
} from '@kenresoft-cms/database';
import type { Database } from '@kenresoft-cms/database';
import { NO_CMS_ACCESS } from '@kenresoft-cms/contracts/schemas/enums';

// A Commerce "customer" is a core `user` (the one shared better-auth identity: credentials,
// sessions, email verification and password reset all live there, docs/PLUGINS.md) plus an
// optional Commerce-specific profile row keyed by that user id. Nothing in this file touches a
// password, a session token or a verification token.
export interface CustomerRecord {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  disabled: boolean;
  phone: string | null;
  createdAt: Date;
}

const customerColumns = {
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: user.emailVerified,
  disabled: user.disabled,
  phone: pluginCommerceCustomerProfiles.phone,
  createdAt: user.createdAt,
};

// Admin-facing lookups only ever see website users (role 'none'). A CMS staff account, the Owner
// above all, is never addressable through Commerce's customer routes, so a Commerce admin
// endpoint can't be used to disable, list or probe staff.
const isWebsiteUser = eq(user.role, NO_CMS_ACCESS);

// This used to be "every website user" (role 'none'), full stop — which meant a plain visitor
// who'd never touched Commerce at all (no order, no address, no saved profile) still showed up
// on Commerce's own Customers page, while Core Users' Website-User/Commerce-Customer badge used
// a *different*, narrower definition — the exact "mismatch and confusion between commerce
// customers and website users" this was built to close. Both surfaces now agree: a "customer"
// is a website user with real Commerce engagement (a placed order, a saved address, or a saved
// profile field), matching apps/api's own isUserCommerceCustomer/listUsersWithLastActive.
async function engagedCustomerUserIds(db: Database): Promise<Set<string>> {
  const [profiles, addresses, orders] = await Promise.all([
    db.select({ userId: pluginCommerceCustomerProfiles.userId }).from(pluginCommerceCustomerProfiles),
    db.selectDistinct({ userId: pluginCommerceCustomerAddresses.customerId }).from(pluginCommerceCustomerAddresses),
    db.selectDistinct({ userId: pluginCommerceOrders.customerId }).from(pluginCommerceOrders),
  ]);
  return new Set([
    ...profiles.map((row) => row.userId),
    ...addresses.map((row) => row.userId),
    ...orders.map((row) => row.userId).filter((id): id is string => id !== null),
  ]);
}

// Deliberately NOT filtered by engagement, unlike listCustomers below — a direct id lookup is
// how staff reach a specific website user (e.g. from Core Users' own directory, which lists
// every account regardless of Commerce engagement) to view or disable them, including someone
// who hasn't ordered anything yet. Narrowing this too would make a legitimate, pre-emptive
// "disable this suspicious signup" action 404 for no good reason.
export async function getCustomerById(db: Database, id: string): Promise<CustomerRecord | undefined> {
  const [row] = await db
    .select(customerColumns)
    .from(user)
    .leftJoin(pluginCommerceCustomerProfiles, eq(pluginCommerceCustomerProfiles.userId, user.id))
    .where(and(eq(user.id, id), isWebsiteUser));
  return row;
}

export async function listCustomers(db: Database, search?: string): Promise<CustomerRecord[]> {
  const [rows, engaged] = await Promise.all([
    db
      .select(customerColumns)
      .from(user)
      .leftJoin(pluginCommerceCustomerProfiles, eq(pluginCommerceCustomerProfiles.userId, user.id))
      .where(search ? and(isWebsiteUser, or(like(user.email, `%${search}%`), like(user.name, `%${search}%`))) : isWebsiteUser)
      .orderBy(desc(user.createdAt)),
    engagedCustomerUserIds(db),
  ]);
  return rows.filter((row) => engaged.has(row.id));
}

export async function getProfilePhone(db: Database, userId: string): Promise<string | null> {
  const profile = await db.query.pluginCommerceCustomerProfiles.findFirst({
    where: eq(pluginCommerceCustomerProfiles.userId, userId),
  });
  return profile?.phone ?? null;
}

// The signed-in user editing their OWN details: name lives on the core user row, phone on the
// Commerce profile (created on first write). Email is deliberately not editable here: it is the
// account's identity and belongs to the core account system.
export async function updateOwnProfile(
  db: Database,
  userId: string,
  input: { name?: string | undefined; phone?: string | null | undefined },
): Promise<void> {
  if (input.name !== undefined) {
    await db.update(user).set({ name: input.name }).where(eq(user.id, userId));
  }
  if (input.phone !== undefined) {
    await db
      .insert(pluginCommerceCustomerProfiles)
      .values({ userId, phone: input.phone })
      .onConflictDoUpdate({
        target: pluginCommerceCustomerProfiles.userId,
        set: { phone: input.phone, updatedAt: new Date() },
      });
  }
}

// Disabling revokes every session for that user immediately, the same behavior as CMS user
// disabling (apps/api's repositories/sessions.ts). Applies only to website users.
export async function setCustomerDisabled(db: Database, id: string, disabled: boolean): Promise<CustomerRecord | undefined> {
  const [updated] = await db
    .update(user)
    .set({ disabled })
    .where(and(eq(user.id, id), isWebsiteUser))
    .returning({ id: user.id });
  if (!updated) return undefined;
  if (disabled) await db.delete(session).where(eq(session.userId, id));
  return getCustomerById(db, id);
}
