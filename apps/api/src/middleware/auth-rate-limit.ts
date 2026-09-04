import type { MiddlewareHandler } from 'hono';

import type { Bindings } from '../lib/env';

// Only POST — GET covers get-session, which the admin SPA calls on every load/navigation, so
// limiting it would cause real false-positive lockouts for normal use. POST covers sign-in,
// sign-up, sign-out, and every other credential-mutating action better-auth exposes here.
export const authRateLimit: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  if (c.req.method !== 'POST') {
    return next();
  }

  const rateLimitKey = c.req.header('CF-Connecting-IP') ?? 'local-dev';
  const { success } = await c.env.AUTH_RATE_LIMITER.limit({ key: rateLimitKey });
  if (!success) {
    // Every caller of a POST /api/v1/auth/* route goes through better-auth's own client
    // (authClient.signIn/signUp/twoFactor.*/changePassword/...), which parses a non-2xx JSON
    // body and surfaces its top-level `message` field as `error.message` — a plain
    // `{ error: "..." }` string body left `.message` undefined everywhere, so every caller's
    // `authError?.message ?? '<action-specific fallback>'` silently showed the wrong fallback
    // (e.g. two-factor enrollment's "check your password") on an actual 429, not the real cause.
    return c.json({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' }, 429);
  }

  return next();
};
