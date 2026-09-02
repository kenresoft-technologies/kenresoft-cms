import { and, eq, gt, like, verification } from '@kenresoft-cms/database';
import { constantTimeEqual, generateRandomString } from 'better-auth/crypto';
import type { Database } from '@kenresoft-cms/database';

// Reuses better-auth's own `verification` table rather than a new one — but not better-auth's
// own password-reset routes, which store the raw token in plaintext in `identifier`
// (confirmed against the installed better-auth@1.4.21 dist). This stores only a SHA-256 hash
// of the token, so a read of this table (a backup, a compromised replica) can't be used to
// reset anyone's password. `identifier` is `password-reset:{userId}` — one live token per
// user; requesting a new one invalidates any previous one for that user. `value` is the hash.
const IDENTIFIER_PREFIX = 'password-reset:';
const TOKEN_TTL_MS = 60 * 60 * 1000;

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Returns the raw token to email to the user — never stored anywhere, including here.
export async function createPasswordResetToken(db: Database, userId: string): Promise<string> {
  const identifier = `${IDENTIFIER_PREFIX}${userId}`;
  await db.delete(verification).where(eq(verification.identifier, identifier));

  const token = generateRandomString(48);
  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier,
    value: await hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });

  return token;
}

// The token alone doesn't reveal which user it's for, so this scans every live password-reset
// row rather than looking one up by id — fine at this scale (a single-site CMS's user count),
// and every comparison still runs through constantTimeEqual so no row's timing stands out.
// Single-use: the matched row is deleted before returning.
export async function consumePasswordResetToken(db: Database, token: string): Promise<string | null> {
  const tokenHash = await hashToken(token);
  const candidates = await db.query.verification.findMany({
    where: and(like(verification.identifier, `${IDENTIFIER_PREFIX}%`), gt(verification.expiresAt, new Date())),
  });

  for (const candidate of candidates) {
    if (constantTimeEqual(candidate.value, tokenHash)) {
      await db.delete(verification).where(eq(verification.id, candidate.id));
      return candidate.identifier.slice(IDENTIFIER_PREFIX.length);
    }
  }

  return null;
}
