import { count, eq, recoveryCode } from '@kenresoft/database';
import { constantTimeEqual, generateRandomString } from 'better-auth/crypto';
import type { Database } from '@kenresoft/database';

const CODE_COUNT = 10;

async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function formatCode(): string {
  // Two groups of 5 from a 32-character alphabet (no lowercase, so it reads the same
  // transcribed by hand as it does on screen) — about 25 bits per group, 50 bits total, which
  // is plenty for a single-use, rate-limited-at-redemption secret.
  return `${generateRandomString(5, '0-9', 'A-Z')}-${generateRandomString(5, '0-9', 'A-Z')}`;
}

// Regenerating always fully replaces the set — every previous code (used or not) stops working,
// which is also how "revoke" is implemented (apps/api/src/routes/admin/security.ts's revoke
// endpoint just calls this with zero new codes to store). Returns the plaintext codes exactly
// once; nothing plaintext is ever written to the table.
export async function replaceRecoveryCodes(db: Database, userId: string, total = CODE_COUNT): Promise<string[]> {
  await db.delete(recoveryCode).where(eq(recoveryCode.userId, userId));

  const codes = Array.from({ length: total }, formatCode);
  if (codes.length > 0) {
    const rows = await Promise.all(
      codes.map(async (code) => ({
        id: crypto.randomUUID(),
        userId,
        codeHash: await hashCode(code),
      })),
    );
    await db.insert(recoveryCode).values(rows);
  }

  return codes;
}

export async function countUnusedRecoveryCodes(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(recoveryCode)
    .where(eq(recoveryCode.userId, userId));
  return row?.count ?? 0;
}

// Single-use: the matched row is deleted (not just marked used) so the table only ever holds
// codes that still work, matching the password-reset token's delete-on-consume pattern. Scans
// every unused code for this user rather than looking one up directly, comparing each through
// constantTimeEqual — the per-user code count is small (10) so this is cheap, and no
// individual code's timing stands out.
export async function consumeRecoveryCode(db: Database, userId: string, code: string): Promise<boolean> {
  const codeHash = await hashCode(code);
  const candidates = await db.query.recoveryCode.findMany({ where: eq(recoveryCode.userId, userId) });

  for (const candidate of candidates) {
    if (constantTimeEqual(candidate.codeHash, codeHash)) {
      await db.delete(recoveryCode).where(eq(recoveryCode.id, candidate.id));
      return true;
    }
  }

  return false;
}
