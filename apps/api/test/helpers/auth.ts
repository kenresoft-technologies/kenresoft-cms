import { SELF } from 'cloudflare:test';

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
// creates a session for anyone, including the very first (owner) signup — no bootstrap
// exception, by design (docs/ARCHITECTURE.md's Changelog). Every test file across this suite
// that previously extracted a session cookie straight off the sign-up response now needs one
// extra real step first: consume the verification email's own token, then sign in for real.
// This is the one shared implementation every file's local authedCookie()/signUp()-style
// helper delegates to, instead of 30+ files reimplementing the same three-request sequence.
export async function signUpVerifiedAndGetCookie(
  email: string,
  options: { password?: string; name?: string } = {},
): Promise<string> {
  const password = options.password ?? 'correct horse battery staple';
  const name = options.name ?? 'Test User';

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
