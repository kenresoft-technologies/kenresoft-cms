import { eq, gt, and, pluginCommerceCustomerSessions, pluginCommerceCustomers } from '@kenresoft-cms/database';
import type { Database, PluginCommerceCustomer } from '@kenresoft-cms/database';

import { generateRandomString } from '../lib/random';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, fixed at creation, no sliding refresh.

async function hashToken(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Returns the raw token — only its hash is ever persisted (plugin_commerce_customer_sessions).
// The raw value is handed to the caller once, to be set as the session cookie, and never stored.
export async function createCustomerSession(db: Database, customerId: string): Promise<string> {
  const rawToken = generateRandomString(48, 'a-z', 'A-Z', '0-9');
  const tokenHash = await hashToken(rawToken);
  await db.insert(pluginCommerceCustomerSessions).values({
    customerId,
    tokenHash,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return rawToken;
}

// Hashes the raw token and looks it up directly by its hash — unlike a low-entropy, small-set
// secret (recovery codes, scanned and constant-time-compared since there are only ~10 candidates
// to distinguish by content), a 48-char random session token has enough entropy that this index
// lookup itself isn't a meaningful timing channel; there's no smaller "already known" identifier
// to scope the lookup by in the first place, since the token IS the identifier. Returns null for
// any invalid, expired, or disabled-customer session — the caller never learns which.
export async function getCustomerBySessionToken(db: Database, rawToken: string): Promise<PluginCommerceCustomer | null> {
  const tokenHash = await hashToken(rawToken);
  const session = await db.query.pluginCommerceCustomerSessions.findFirst({
    where: and(eq(pluginCommerceCustomerSessions.tokenHash, tokenHash), gt(pluginCommerceCustomerSessions.expiresAt, new Date())),
  });
  if (!session) return null;

  const customer = await db.query.pluginCommerceCustomers.findFirst({
    where: eq(pluginCommerceCustomers.id, session.customerId),
  });
  if (!customer || customer.disabled) return null;
  return customer;
}

export async function deleteCustomerSession(db: Database, rawToken: string): Promise<void> {
  const tokenHash = await hashToken(rawToken);
  await db.delete(pluginCommerceCustomerSessions).where(eq(pluginCommerceCustomerSessions.tokenHash, tokenHash));
}

// Called on password change and on disable — mirrors the CMS's own disable-revokes-sessions
// behavior exactly.
export async function deleteAllSessionsForCustomer(db: Database, customerId: string): Promise<void> {
  await db.delete(pluginCommerceCustomerSessions).where(eq(pluginCommerceCustomerSessions.customerId, customerId));
}
