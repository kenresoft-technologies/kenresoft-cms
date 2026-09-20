import { SELF, env } from 'cloudflare:test';

import { createAuth } from '../../src/lib/auth';
import type { Bindings } from '../../src/lib/env';
import { getTestEmails } from '../../src/lib/email';

// Whenever better-auth's real internals throw an APIError during a request a test deliberately
// provokes (an unverified sign-in, an invalid/expired verify-email token), the same error also
// escapes as a genuinely unhandled promise rejection independent of the correctly-returned HTTP
// response — a pre-existing better-auth/better-call quirk, reproduced identically on Linux CI,
// already documented and worked around elsewhere in this codebase (commit 6b041b9; see
// password-reset.test.ts, owner-protection.test.ts, security-elevate.test.ts). Those files
// avoided it by never exercising the throwing path — not an option when triggering exactly that
// rejection *is* the behavior under test. This listens for the single expected rejection during
// the wrapped call and removes itself immediately after, rather than a file-wide suppression
// that could mask an unrelated bug.
export async function withExpectedInternalRejection<T>(run: () => Promise<T>): Promise<T> {
  const onRejection = () => {};
  process.on('unhandledRejection', onRejection);
  try {
    return await run();
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', onRejection);
  }
}

// Extracts the token from the most recently captured verify-email link for `email` — shared by
// signUpVerifiedAndGetCookie below and any test that needs to consume (or deliberately not
// consume) a real verification token directly.
export function extractVerificationToken(email: string): string {
  const verificationEmail = getTestEmails()
    .filter((message) => message.to === email && message.html?.includes('/verify-email?token='))
    .at(-1);
  if (!verificationEmail?.html) {
    throw new Error(`no verification email captured for ${email} — is EMAIL_PROVIDER=test set in wrangler.test.toml?`);
  }
  const tokenMatch = verificationEmail.html.match(/verify-email\?token=([^"&\s]+)/);
  if (!tokenMatch) {
    throw new Error(`verification email for ${email} had no token link`);
  }
  return tokenMatch[1]!;
}

// requireEmailVerification (apps/api/src/lib/auth-options.ts) means sign-up alone no longer
// creates a session for anyone now (bootstrap or not — see below). Every test file across this
// suite that previously extracted a session cookie straight off the sign-up response now needs
// one extra real step first: consume the verification email's own token, then sign in for real.
// This is the one shared implementation every file's local authedCookie()/signUp()-style
// helper delegates to, instead of 30+ files reimplementing the same three-request sequence.
//
// `promoteFirstUserToOwner` (default true) preserves this helper's long-standing behavior for
// every existing caller — the first account created in a given test's isolated D1 ends up an
// Owner, so the ~40+ test files that need *some* privileged session don't each need their own
// bootstrap-token dance — but it does so as a direct, test-only D1 write, never through the real
// app code. The real app (apps/api/src/lib/auth.ts) no longer auto-grants Owner to a bare first
// signup at all (see routes/system/bootstrap-owner.ts and installation-bootstrap.test.ts for the
// real bootstrap flow this replaced) — this helper's promotion is a testing convenience for
// getting a privileged fixture quickly, not a claim that production behaves this way.
export async function signUpVerifiedAndGetCookie(
  email: string,
  options: { password?: string; name?: string; promoteFirstUserToOwner?: boolean; role?: string } = {},
): Promise<string> {
  const password = options.password ?? 'correct horse battery staple';
  const name = options.name ?? 'Test User';
  const promoteFirstUserToOwner = options.promoteFirstUserToOwner ?? true;

  const signUpResponse = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (signUpResponse.status !== 200) {
    throw new Error(`sign-up failed for ${email}: ${signUpResponse.status} ${await signUpResponse.text()}`);
  }

  const token = extractVerificationToken(email);
  const verifyResponse = await SELF.fetch(`https://example.com/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
  if (verifyResponse.status !== 200) {
    throw new Error(`verification failed for ${email}: ${verifyResponse.status}`);
  }

  // Real sign-up now yields a user with NO CMS access (role 'none' — anything that merely creates an
  // account must never confer a CMS role). Test fixtures that need a privileged session grant one
  // directly in D1, never through app code: the first account becomes Owner (unless disabled), every
  // later one gets `options.role` (default 'editor', what Add User has always produced).
  let grantedRole: string | undefined = options.role;
  if (!grantedRole && promoteFirstUserToOwner) {
    const { results } = await env.DB.prepare('SELECT COUNT(*) as count FROM user').all<{ count: number }>();
    if ((results[0]?.count ?? 0) === 1) grantedRole = 'owner';
  }
  grantedRole ??= 'editor';
  if (grantedRole !== 'none') {
    await env.DB.prepare('UPDATE user SET role = ? WHERE email = ?').bind(grantedRole, email).run();
  }

  const signInResponse = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = signInResponse.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error(`sign-in did not return a session cookie for ${email}`);
  }
  return setCookie.split(';')[0]!;
}

// Creates a normal website user (role 'none' — e.g. a Commerce storefront customer) through the
// real, shared better-auth instance and returns a real session cookie for it. Uses better-auth's
// server-side API (not the rate-limited HTTP routes), so a test file can create many users without
// tripping AUTH_RATE_LIMITER's per-file budget.
export async function registerWebsiteUser(
  email: string,
  options: { password?: string; name?: string; verified?: boolean } = {},
): Promise<{ customer: { id: string; email: string; name: string }; cookie: string }> {
  const password = options.password ?? 'correct horse battery staple';
  const name = options.name ?? 'Test Customer';
  const auth = createAuth(env as unknown as Bindings);
  const result = await auth.api.signUpEmail({ body: { email, password, name } });
  const id = (result.user as { id: string }).id;
  const customer = { id, email, name };
  // Unverified users can't sign in at all (requireEmailVerification), so there is no cookie.
  if (options.verified === false) return { customer, cookie: '' };
  await env.DB.prepare('UPDATE user SET email_verified = 1 WHERE id = ?').bind(id).run();
  const signIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const setCookie = signIn.headers.get('set-cookie');
  if (!setCookie) throw new Error(`sign-in did not return a session cookie for ${email}`);
  return { customer, cookie: setCookie.split(';')[0]! };
}
