import type { MiddlewareHandler } from 'hono';

import { createAuth } from '../lib/auth';
import type { Bindings } from '../lib/env';

// Any signed-in account, website or staff — unlike requireSession (admin routes), a CMS role is
// neither needed nor granted here. Routes behind this only ever act on the account's own data.
export interface AccountUser {
  id: string;
  email: string;
  name: string;
}

export type AccountVariables = { account: AccountUser };

export async function resolveAccount(env: Bindings, headers: Headers): Promise<AccountUser | null> {
  if (!headers.get('cookie')) return null;
  const result = await createAuth(env).api.getSession({ headers });
  if (!result) return null;
  const user = result.user as unknown as AccountUser & { disabled: boolean; emailVerified: boolean };
  if (user.disabled || !user.emailVerified) return null;
  return { id: user.id, email: user.email, name: user.name };
}

export const requireAccount: MiddlewareHandler<{ Bindings: Bindings; Variables: AccountVariables }> = async (c, next) => {
  const account = await resolveAccount(c.env, c.req.raw.headers);
  if (!account) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('account', account);
  await next();
};

// State-changing account requests must come from a trusted origin. Stricter than
// requireTrustedOrigin (admin), which lets a request without an Origin header through: a
// browser always sends Origin on a cross-site or same-site POST, so a missing one here means a
// non-browser client that has no business using a visitor's session cookie.
export const requireAccountOrigin: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
  const origin = c.req.header('Origin');
  const allowList = c.env.CORS_ORIGINS.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!origin || !allowList.includes(origin)) {
    return c.json({ error: 'Origin not allowed' }, 403);
  }
  return next();
};
