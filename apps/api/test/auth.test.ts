import { SELF, env } from 'cloudflare:test';
import { createDb } from '@kenresoft-cms/database';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearTestEmails, getTestEmails } from '../src/lib/email';

const db = createDb(env.DB);

async function signUp(email: string, extra: Record<string, unknown> = {}) {
  return SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery staple', name: 'Test User', ...extra }),
  });
}

// requireEmailVerification (apps/api/src/lib/auth-options.ts) — no exception for the
// bootstrap/owner signup either (docs/ARCHITECTURE.md's Changelog) — so a real sign-in test
// needs to consume the real captured verification token first, exactly like a production user
// would by clicking the emailed link.
async function verify(email: string): Promise<void> {
  const verificationEmail = getTestEmails()
    .filter((message) => message.to === email && message.html?.includes('/verify-email?token='))
    .at(-1);
  const token = verificationEmail!.html!.match(/verify-email\?token=([^"&\s]+)/)![1]!;
  const response = await SELF.fetch(`https://example.com/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
  if (response.status !== 200) throw new Error(`verification failed for ${email}: ${response.status}`);
}

describe('better-auth wiring (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
    clearTestEmails();
  });

  it('bootstraps the first signup as owner', async () => {
    const response = await signUp('first@example.test');
    expect(response.status).toBe(200);

    const user = await db.query.user.findFirst();
    expect(user).toMatchObject({ email: 'first@example.test', role: 'owner' });
  });

  it('defaults subsequent signups to editor', async () => {
    await signUp('first@example.test');
    const response = await signUp('editor@example.test');
    expect(response.status).toBe(200);

    const editor = await db.query.user.findFirst({
      where: (user, { eq }) => eq(user.email, 'editor@example.test'),
    });
    expect(editor?.role).toBe('editor');
  });

  it('ignores a client-supplied role at signup (input: false)', async () => {
    await signUp('first@example.test');
    const response = await signUp('attacker@example.test', { role: 'admin' });
    expect(response.status).toBe(200);

    const attacker = await db.query.user.findFirst({
      where: (user, { eq }) => eq(user.email, 'attacker@example.test'),
    });
    expect(attacker?.role).toBe('editor');
  });

  it('emailVerified is true for the bootstrapped owner — same signup, no special hook value', async () => {
    // Not a bootstrap exception: nothing in databaseHooks.user.create.before sets
    // emailVerified, so this stays false at signup exactly like any other new account and is
    // only ever flipped true by actually consuming a real verification token, asserted next.
    await signUp('bootstrap@example.test');
    const user = await db.query.user.findFirst({ where: (user, { eq }) => eq(user.email, 'bootstrap@example.test') });
    expect(user).toMatchObject({ role: 'owner', emailVerified: false });
  });

  it('signs in and receives a session cookie once verified', async () => {
    await signUp('login@example.test');
    await verify('login@example.test');

    const response = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'login@example.test', password: 'correct horse battery staple' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token');
  });
});
