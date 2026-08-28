import type { MiddlewareHandler } from 'hono';

import { createAuth } from '../lib/auth';
import type { Bindings } from '../lib/env';

// Mirrors @kenresoft/contracts' USER_ROLES and src/lib/auth.ts's admin-bootstrap hook.
export type Role = 'admin' | 'editor' | 'author' | 'viewer';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

export type AuthedVariables = { user: SessionUser };

export const requireSession: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AuthedVariables;
}> = async (c, next) => {
  const auth = createAuth(c.env);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!result) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // better-auth types the "role" additionalField as plain string — the union narrows it to
  // what auth.ts's owner-bootstrap hook and the schema default actually ever assign.
  c.set('user', result.user as SessionUser);
  await next();
};
