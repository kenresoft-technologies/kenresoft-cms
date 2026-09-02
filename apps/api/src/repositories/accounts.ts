import { account, and, eq } from '@kenresoft-cms/database';
import type { Database } from '@kenresoft-cms/database';

// better-auth stores the email/password credential as one `account` row per user with
// providerId 'credential' (confirmed against the installed better-auth@1.4.21 dist, not just
// docs) — there's no public API to set a password outside of an authenticated request, so both
// self-service recovery (password-reset confirm, recovery-code redeem) and the owner-recovery
// tools update this row directly, hashing with the same `better-auth/crypto` scrypt
// implementation better-auth's own sign-in verifies against.
export function getCredentialAccount(db: Database, userId: string) {
  return db.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, 'credential')),
  });
}

export async function updateAccountPassword(db: Database, accountId: string, passwordHash: string): Promise<void> {
  await db.update(account).set({ password: passwordHash }).where(eq(account.id, accountId));
}
