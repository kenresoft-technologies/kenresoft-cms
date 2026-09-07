import { eq, gt, and, pluginCommerceCustomerTokens } from '@kenresoft-cms/database';
import type { Database, PluginCommerceCustomerToken } from '@kenresoft-cms/database';

import { generateRandomString } from '../lib/random';

export type CustomerTokenPurpose = PluginCommerceCustomerToken['purpose'];

const TTL_MS: Record<CustomerTokenPurpose, number> = {
  password_reset: 60 * 60 * 1000, // 1 hour — matches the CMS's own password-reset token TTL.
  email_verification: 24 * 60 * 60 * 1000, // 24 hours — lower stakes, no rush.
};

async function hashToken(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Deletes any existing unconsumed token of the same (customerId, purpose) first — "requesting a
// new token invalidates the previous one," matching the CMS's own password-reset behavior.
// Returns the raw token — only its hash is ever persisted.
export async function createCustomerToken(
  db: Database,
  customerId: string,
  purpose: CustomerTokenPurpose,
): Promise<string> {
  await db
    .delete(pluginCommerceCustomerTokens)
    .where(and(eq(pluginCommerceCustomerTokens.customerId, customerId), eq(pluginCommerceCustomerTokens.purpose, purpose)));

  const rawToken = generateRandomString(32, 'a-z', 'A-Z', '0-9');
  await db.insert(pluginCommerceCustomerTokens).values({
    customerId,
    purpose,
    tokenHash: await hashToken(rawToken),
    expiresAt: new Date(Date.now() + TTL_MS[purpose]),
  });
  return rawToken;
}

// Single-use, enforced by deletion on successful consumption — the same mechanism recovery-codes
// and the CMS's own password-reset tokens already use, not a separate usedAt/status column.
// Returns the customerId on success, null on any invalid/expired/wrong-purpose token (the caller
// never learns which — see the account-enumeration section of the plan).
export async function consumeCustomerToken(
  db: Database,
  rawToken: string,
  purpose: CustomerTokenPurpose,
): Promise<string | null> {
  const tokenHash = await hashToken(rawToken);
  const row = await db.query.pluginCommerceCustomerTokens.findFirst({
    where: and(
      eq(pluginCommerceCustomerTokens.tokenHash, tokenHash),
      eq(pluginCommerceCustomerTokens.purpose, purpose),
      gt(pluginCommerceCustomerTokens.expiresAt, new Date()),
    ),
  });
  if (!row) return null;

  await db.delete(pluginCommerceCustomerTokens).where(eq(pluginCommerceCustomerTokens.id, row.id));
  return row.customerId;
}
