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
    return c.json({ error: 'Too many requests, please try again later' }, 429);
  }

  return next();
};
