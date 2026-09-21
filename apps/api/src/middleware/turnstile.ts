import type { MiddlewareHandler } from 'hono';

import { getClientIp } from '../lib/client-ip';
import type { Bindings } from '../lib/env';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SIGN_UP_PATH = '/api/v1/auth/sign-up/email';
const TOKEN_HEADER = 'x-turnstile-token';
const MAX_TOKEN_LENGTH = 2048;

export type TurnstileResult = 'passed' | 'failed' | 'unavailable';

// Cloudflare's server-side check for a token the visitor's browser got from the Turnstile widget.
// `unavailable` means we couldn't reach the verification service — the caller decides what that
// means; for sign-up it fails closed (a 503), never silently letting the request through.
export async function verifyTurnstileToken(secret: string, token: string, remoteIp?: string): Promise<TurnstileResult> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  try {
    const response = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    if (!response.ok) return 'unavailable';
    const result = (await response.json()) as { success?: boolean };
    return result.success === true ? 'passed' : 'failed';
  } catch {
    return 'unavailable';
  }
}

// Optional bot protection for public website sign-up (POST /api/v1/auth/sign-up/email) — the one
// unauthenticated route that creates rows. Opt-in: does nothing at all unless the deployment has
// a TURNSTILE_SECRET_KEY Worker secret (`wrangler secret put TURNSTILE_SECRET_KEY`), so every
// existing deployment behaves exactly as before. The visitor's token travels in the
// `x-turnstile-token` header (not the body, which better-auth validates itself). Staff accounts
// are created through Add User, a separate route this doesn't touch.
export const signUpTurnstile: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  if (c.req.method !== 'POST' || new URL(c.req.url).pathname !== SIGN_UP_PATH) return next();

  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret) return next();

  const token = c.req.header(TOKEN_HEADER);
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return c.json({ code: 'TURNSTILE_REQUIRED', message: 'Complete the human check to create an account.' }, 400);
  }

  const ip = getClientIp(c.req.raw.headers, c.env);
  const result = await verifyTurnstileToken(secret, token, ip === 'local-dev' ? undefined : ip);
  if (result === 'unavailable') {
    return c.json({ code: 'TURNSTILE_UNAVAILABLE', message: 'The human check could not be verified. Please try again.' }, 503);
  }
  if (result === 'failed') {
    return c.json({ code: 'TURNSTILE_FAILED', message: 'The human check failed. Please try again.' }, 403);
  }
  return next();
};
