import { SELF, env } from 'cloudflare:test';
import { createDb, eq, verification } from '@kenresoft-cms/database';
import { verifyPassword } from 'better-auth/crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { createPasswordResetToken } from '../src/repositories/password-reset';
import { getCredentialAccount } from '../src/repositories/accounts';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a completely different passphrase';

const db = createDb(env.DB);

async function signUp(email: string): Promise<string> {
  const response = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Test User' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up did not return a session cookie');
  return setCookie.split(';')[0]!;
}

async function requestReset(email: string) {
  return SELF.fetch('https://example.com/api/v1/public/password-reset/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

async function confirmReset(token: string, newPassword = NEW_PASSWORD) {
  return SELF.fetch('https://example.com/api/v1/public/password-reset/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
}

async function signIn(email: string, password: string) {
  return SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('password reset (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM verification');
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
  });

  it('responds identically whether or not the email matches an account', async () => {
    await signUp('pw-reset-exists@example.test');

    const existing = await requestReset('pw-reset-exists@example.test');
    const missing = await requestReset('pw-reset-does-not-exist@example.test');

    expect(existing.status).toBe(200);
    expect(missing.status).toBe(200);
    expect(await existing.json()).toEqual(await missing.json());
  });

  it('resets the password and signs out every existing session', async () => {
    const cookie = await signUp('pw-reset-flow@example.test');
    const sessionsBefore = await env.DB.prepare('SELECT count(*) as n FROM session').first<{ n: number }>();
    expect(sessionsBefore?.n).toBeGreaterThan(0);

    const userRow = await env.DB.prepare("SELECT id FROM user WHERE email = 'pw-reset-flow@example.test'").first<{
      id: string;
    }>();
    const token = await createPasswordResetToken(db, userRow!.id);

    const response = await confirmReset(token);
    expect(response.status).toBe(200);

    const sessionsAfter = await env.DB.prepare('SELECT count(*) as n FROM session').first<{ n: number }>();
    expect(sessionsAfter?.n).toBe(0);

    // The old cookie is dead — its underlying session row is gone.
    const staleCheck = await SELF.fetch('https://example.com/api/v1/auth/get-session', {
      headers: { Cookie: cookie },
    });
    expect(await staleCheck.json()).toBeNull();

    // Checked by verifying the stored hash directly rather than via the full sign-in HTTP
    // route with a deliberately wrong password — better-auth/better-call surface that failure
    // as an unhandled rejection inside this Workers test runtime, unrelated to anything this
    // route does, which would otherwise make an intentionally-negative assertion fail the run.
    const credentialAccount = await getCredentialAccount(db, userRow!.id);
    expect(await verifyPassword({ hash: credentialAccount!.password!, password: PASSWORD })).toBe(false);
    expect(await verifyPassword({ hash: credentialAccount!.password!, password: NEW_PASSWORD })).toBe(true);

    const newPasswordSignIn = await signIn('pw-reset-flow@example.test', NEW_PASSWORD);
    expect(newPasswordSignIn.status).toBe(200);
  });

  it('rejects an unknown token', async () => {
    const response = await confirmReset('not-a-real-token');
    expect(response.status).toBe(400);
  });

  it('is single-use — the same token cannot be redeemed twice', async () => {
    await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pw-reset-once@example.test', password: PASSWORD, name: 'Test User' }),
    });
    const userRow = await env.DB.prepare("SELECT id FROM user WHERE email = 'pw-reset-once@example.test'").first<{
      id: string;
    }>();
    const token = await createPasswordResetToken(db, userRow!.id);

    const first = await confirmReset(token);
    expect(first.status).toBe(200);

    const second = await confirmReset(token);
    expect(second.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pw-reset-expired@example.test', password: PASSWORD, name: 'Test User' }),
    });
    const userRow = await env.DB.prepare("SELECT id FROM user WHERE email = 'pw-reset-expired@example.test'").first<{
      id: string;
    }>();
    const token = await createPasswordResetToken(db, userRow!.id);
    await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `password-reset:${userRow!.id}`));

    const response = await confirmReset(token);
    expect(response.status).toBe(400);
  });

  it('requesting a new token invalidates the previous one', async () => {
    await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pw-reset-replace@example.test', password: PASSWORD, name: 'Test User' }),
    });
    const userRow = await env.DB.prepare("SELECT id FROM user WHERE email = 'pw-reset-replace@example.test'").first<{
      id: string;
    }>();

    const firstToken = await createPasswordResetToken(db, userRow!.id);
    const secondToken = await createPasswordResetToken(db, userRow!.id);

    const firstAttempt = await confirmReset(firstToken);
    expect(firstAttempt.status).toBe(400);

    const secondAttempt = await confirmReset(secondToken);
    expect(secondAttempt.status).toBe(200);
  });
});
