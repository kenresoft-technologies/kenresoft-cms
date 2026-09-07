import { eq, pluginCommerceCustomers } from '@kenresoft-cms/database';
import type { Database, PluginCommerceCustomer } from '@kenresoft-cms/database';
import { hashPassword, verifyPassword } from '@better-auth/utils/password';

// Commerce's customer identity is deliberately separate from better-auth (CMS staff only) — this
// package depends only on @better-auth/utils' standalone hashing primitives (the same
// implementation better-auth itself builds on internally — better-auth/crypto's own
// hashPassword/verifyPassword are a thin wrapper over this exact package), never on
// better-auth's own identity/session/database-adapter system or any betterAuth({...}) instance
// (docs/PLUGINS.md's Commerce section). @better-auth/utils has no dependency of its own beyond
// @noble/hashes, so depending on it directly (rather than the full better-auth package) avoids
// pulling in @better-auth/core/better-call/zod as real, resolved dependencies — which, in an
// earlier version of this file, shifted pnpm's shared peer-resolution for every other
// better-auth consumer in the workspace onto a different zod version and broke their typecheck.

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type CustomerWritable = {
  email: string;
  name: string;
  phone?: string | null | undefined;
};

export async function createCustomer(
  db: Database,
  input: CustomerWritable & { password: string },
): Promise<PluginCommerceCustomer> {
  const passwordHash = await hashPassword(input.password);
  const [row] = await db
    .insert(pluginCommerceCustomers)
    .values({
      email: normalizeEmail(input.email),
      name: input.name,
      phone: input.phone ?? null,
      passwordHash,
    })
    .returning();
  return row!;
}

export function getCustomerById(db: Database, id: string): Promise<PluginCommerceCustomer | undefined> {
  return db.query.pluginCommerceCustomers.findFirst({ where: eq(pluginCommerceCustomers.id, id) });
}

export function getCustomerByEmail(db: Database, email: string): Promise<PluginCommerceCustomer | undefined> {
  return db.query.pluginCommerceCustomers.findFirst({
    where: eq(pluginCommerceCustomers.email, normalizeEmail(email)),
  });
}

export async function verifyCustomerPassword(customer: PluginCommerceCustomer, password: string): Promise<boolean> {
  return verifyPassword(customer.passwordHash, password);
}

type CustomerPatch = { [K in keyof CustomerWritable]?: CustomerWritable[K] | undefined };

export async function updateCustomer(
  db: Database,
  id: string,
  input: CustomerPatch,
): Promise<PluginCommerceCustomer | undefined> {
  const values: Record<string, unknown> = { ...input, updatedAt: new Date() };
  if (input.email !== undefined) values.email = normalizeEmail(input.email);
  const [row] = await db
    .update(pluginCommerceCustomers)
    .set(values)
    .where(eq(pluginCommerceCustomers.id, id))
    .returning();
  return row;
}

export async function markCustomerEmailVerified(db: Database, id: string): Promise<void> {
  await db
    .update(pluginCommerceCustomers)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(pluginCommerceCustomers.id, id));
}

export async function updateCustomerPassword(db: Database, id: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db
    .update(pluginCommerceCustomers)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(pluginCommerceCustomers.id, id));
}

export async function setCustomerDisabled(db: Database, id: string, disabled: boolean): Promise<PluginCommerceCustomer | undefined> {
  const [row] = await db
    .update(pluginCommerceCustomers)
    .set({ disabled, updatedAt: new Date() })
    .where(eq(pluginCommerceCustomers.id, id))
    .returning();
  return row;
}
