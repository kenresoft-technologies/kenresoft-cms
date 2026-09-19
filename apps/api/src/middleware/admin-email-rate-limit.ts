import type { MiddlewareHandler } from 'hono';

import type { Bindings } from '../lib/env';
import type { AuthedVariables } from './require-session';

// Per staff user (not per IP): caps how much mail one account can send, so a compromised or
// careless account can't be used to spam recipients or burn the deployment's provider quota and
// sender reputation. Must run after requireSession.
export const adminEmailRateLimit: MiddlewareHandler<{ Bindings: Bindings; Variables: AuthedVariables }> = async (
  c,
  next,
) => {
  const { success } = await c.env.ADMIN_EMAIL_RATE_LIMITER.limit({ key: c.get('user').id });
  if (!success) {
    return c.json({ error: 'Too many emails sent in a short time. Please wait a minute and try again.' }, 429);
  }
  return next();
};
