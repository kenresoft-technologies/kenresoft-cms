import type { MiddlewareHandler } from 'hono';

import type { Bindings } from '../lib/env';

// Shared by every self-service account-recovery route (password-reset request/confirm,
// recovery-code redeem) and the break-glass owner-recovery endpoint — all of them either send
// email, attempt a credential-like guess, or both, so all of them get the same conservative
// per-IP limit rather than each route reinventing one.
export const recoveryRateLimit: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const rateLimitKey = c.req.header('CF-Connecting-IP') ?? 'local-dev';
  const { success } = await c.env.RECOVERY_RATE_LIMITER.limit({ key: rateLimitKey });
  if (!success) {
    return c.json({ error: 'Too many requests, please try again later' }, 429);
  }

  return next();
};
