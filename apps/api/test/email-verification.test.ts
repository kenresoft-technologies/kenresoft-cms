import { SELF, env } from 'cloudflare:test';
import { createDb } from '@kenresoft-cms/database';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearTestEmails, getTestEmails } from '../src/lib/email';
import { withExpectedInternalRejection } from './helpers/auth';

const PASSWORD = 'correct horse battery staple';

const db = createDb(env.DB);

async function signUp(email: string, name = 'Test User') {
  return SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
}

async function signIn(email: string, password = PASSWORD) {
  return SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function resend(email: string) {
  return SELF.fetch('https://example.com/api/v1/auth/send-verification-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

async function verify(token: string) {
  return SELF.fetch(`https://example.com/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
}

function extractToken(html: string): string {
  const match = html.match(/verify-email\?token=([^"&\s]+)/);
  if (!match) throw new Error(`no verify-email link found in: ${html}`);
  return match[1]!;
}

async function getUser(email: string) {
  return db.query.user.findFirst({ where: (user, { eq }) => eq(user.email, email) });
}

// A minimal, dependency-free HS256 JWT signer/payload builder — mirrors the exact shape
// better-auth's own createEmailVerificationToken produces (email + exp, HS256, signed with
// BETTER_AUTH_SECRET) so an expired token can be constructed deterministically without pulling
// in `jose` as a new direct dependency (it's only a transitive one here) or mocking the clock
// against the Workers test runtime.
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function signExpiredVerificationToken(email: string, secret: string): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ email, iat: nowSeconds - 7200, exp: nowSeconds - 3600 })),
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

describe('email verification (real D1)', () => {
  beforeEach(async () => {
    await env.DB.exec('DELETE FROM session');
    await env.DB.exec('DELETE FROM account');
    await env.DB.exec('DELETE FROM user');
    clearTestEmails();
  });

  it('captures a sent test email within the same test (module-state smoke check)', async () => {
    expect(getTestEmails()).toHaveLength(0);
    await signUp('smoke-check@example.test');
    expect(getTestEmails().length).toBeGreaterThan(0);
  });

  it('self-signup: emailVerified is false, and a real clickable verification link is emailed', async () => {
    const response = await signUp('self-signup@example.test');
    expect(response.status).toBe(200);

    const user = await getUser('self-signup@example.test');
    expect(user?.emailVerified).toBe(false);

    const emails = getTestEmails().filter((message) => message.to === 'self-signup@example.test');
    expect(emails.length).toBeGreaterThanOrEqual(1);
    const verificationEmail = emails.find((message) => message.html?.includes('/verify-email?token='));
    expect(verificationEmail).toBeDefined();
    expect(verificationEmail!.html).toMatch(/<a href="[^"]*\/verify-email\?token=[^"]+"/);
    // Built from ADMIN_URL when set (unset in wrangler.test.toml, so this falls back to the
    // first CORS_ORIGINS entry) — either way it must point at the Admin app's own
    // /verify-email page, never at this Worker's own baseURL-based redirect URL.
    expect(verificationEmail!.html).toContain(`${env.CORS_ORIGINS.split(',')[0]}/verify-email?token=`);
    expect(verificationEmail!.html).not.toContain(`${env.BETTER_AUTH_URL}/api/v1/auth/verify-email`);
  });

  it('unverified sign-in is rejected, produces no session, and re-sends a fresh verification email', async () => {
    await signUp('unverified-sign-in@example.test');
    clearTestEmails();

    const response = await withExpectedInternalRejection(() => signIn('unverified-sign-in@example.test'));
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();

    const body = (await response.json()) as { code?: string; message?: string };
    expect(body.code ?? body.message).toMatch(/EMAIL_NOT_VERIFIED|Email not verified/i);

    // sendOnSignIn: true — a rejected unverified sign-in also fires a fresh verification email.
    const emails = getTestEmails().filter((message) => message.to === 'unverified-sign-in@example.test');
    expect(emails.length).toBeGreaterThanOrEqual(1);
  });

  it('verifying with the real captured token flips emailVerified and allows sign-in', async () => {
    await signUp('verify-then-signin@example.test');
    const user = await getUser('verify-then-signin@example.test');
    expect(user?.emailVerified).toBe(false);

    const verificationEmail = getTestEmails().find((message) => message.to === 'verify-then-signin@example.test');
    const token = extractToken(verificationEmail!.html!);

    const verifyResponse = await verify(token);
    expect(verifyResponse.status).toBe(200);

    const verifiedUser = await getUser('verify-then-signin@example.test');
    expect(verifiedUser?.emailVerified).toBe(true);

    const signInResponse = await signIn('verify-then-signin@example.test');
    expect(signInResponse.status).toBe(200);
    expect(signInResponse.headers.get('set-cookie')).toContain('better-auth.session_token');
  });

  it('re-verifying an already-verified, still-valid token is idempotent', async () => {
    await signUp('idempotent-verify@example.test');
    const verificationEmail = getTestEmails().find((message) => message.to === 'idempotent-verify@example.test');
    const token = extractToken(verificationEmail!.html!);

    const first = await verify(token);
    expect(first.status).toBe(200);
    const second = await verify(token);
    expect(second.status).toBe(200);
  });

  it('rejects an invalid token', async () => {
    const response = await withExpectedInternalRejection(() => verify('not-a-real-token'));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code?: string; message?: string };
    expect(body.code ?? body.message).toMatch(/INVALID_TOKEN|Invalid token/i);
  });

  it('rejects an expired token', async () => {
    await signUp('expired-token@example.test');
    const token = await signExpiredVerificationToken('expired-token@example.test', env.BETTER_AUTH_SECRET);

    const response = await withExpectedInternalRejection(() => verify(token));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code?: string; message?: string };
    expect(body.code ?? body.message).toMatch(/TOKEN_EXPIRED|Token expired/i);

    const user = await getUser('expired-token@example.test');
    expect(user?.emailVerified).toBe(false);
  });

  it('resend for a real unverified address sends a fresh email', async () => {
    await signUp('resend-me@example.test');
    clearTestEmails();

    const response = await resend('resend-me@example.test');
    expect(response.status).toBe(200);

    const emails = getTestEmails().filter((message) => message.to === 'resend-me@example.test');
    expect(emails.length).toBeGreaterThanOrEqual(1);
  });

  it('resend for a nonexistent address is enumeration-safe: same response, no email sent', async () => {
    const response = await resend('nobody-here@example.test');
    expect(response.status).toBe(200);
    expect(getTestEmails().filter((message) => message.to === 'nobody-here@example.test')).toHaveLength(0);
  });

  it('resend for an already-verified address does not send a new verification email', async () => {
    await signUp('already-verified@example.test');
    const verificationEmail = getTestEmails().find((message) => message.to === 'already-verified@example.test');
    const token = extractToken(verificationEmail!.html!);
    await verify(token);
    clearTestEmails();

    const response = await resend('already-verified@example.test');
    expect(response.status).toBe(200);
    expect(getTestEmails().filter((message) => message.to === 'already-verified@example.test')).toHaveLength(0);
  });

  it('bootstrap owner gets no exception: unverified until it goes through the same verify flow', async () => {
    const response = await signUp('bootstrap-owner@example.test');
    expect(response.status).toBe(200);

    const owner = await getUser('bootstrap-owner@example.test');
    expect(owner).toMatchObject({ role: 'owner', emailVerified: false });

    const blockedSignIn = await withExpectedInternalRejection(() => signIn('bootstrap-owner@example.test'));
    expect(blockedSignIn.status).toBe(403);

    const verificationEmail = getTestEmails().find((message) => message.to === 'bootstrap-owner@example.test');
    const token = extractToken(verificationEmail!.html!);
    const verifyResponse = await verify(token);
    expect(verifyResponse.status).toBe(200);

    const allowedSignIn = await signIn('bootstrap-owner@example.test');
    expect(allowedSignIn.status).toBe(200);
  });

  it('an Add User-created account is unverified just like any other new account', async () => {
    // Bootstrap and verify an owner first so it can authenticate and use the admin route.
    await signUp('admin-owner@example.test');
    const ownerVerificationEmail = getTestEmails().find((message) => message.to === 'admin-owner@example.test');
    await verify(extractToken(ownerVerificationEmail!.html!));
    clearTestEmails();

    const ownerSignIn = await signIn('admin-owner@example.test');
    const ownerCookie = ownerSignIn.headers.get('set-cookie')!.split(';')[0]!;

    const createResponse = await SELF.fetch('https://example.com/api/v1/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ name: 'New Staff Member', email: 'added-by-admin@example.test' }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { user: { emailVerified: boolean } };
    expect(created.user.emailVerified).toBe(false);

    const newUserRow = await getUser('added-by-admin@example.test');
    expect(newUserRow?.emailVerified).toBe(false);

    // Two independent emails: the temp-password onboarding notice (Kenresoft's own send) and
    // better-auth's own verification email (triggered automatically by signUpEmail's
    // sendOnSignUp), both addressed to the new user, distinguishable by subject.
    const newUserEmails = getTestEmails().filter((message) => message.to === 'added-by-admin@example.test');
    expect(newUserEmails.some((message) => message.subject.includes('Verify your email'))).toBe(true);
    expect(newUserEmails.some((message) => message.subject === 'Your Kenresoft CMS account')).toBe(true);
    // Sign-in with the real temporary password isn't exercised here (unlike a wrong-password
    // attempt, which this codebase's other tests deliberately avoid over the HTTP route — a
    // known better-auth/better-call unhandled-rejection quirk, see password-reset.test.ts) —
    // the row-level emailVerified:false assertion above already proves requireEmailVerification
    // will reject it, and that exact rejection path is covered directly by the
    // "unverified sign-in is rejected" test above using a self-signup account instead.
  });
});
