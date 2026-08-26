import type { MiddlewareHandler } from 'hono';

import type { Bindings } from '../lib/env';
import type { AuthedVariables, Role } from './require-session';

export function requireRole(
  ...roles: Role[]
): MiddlewareHandler<{ Bindings: Bindings; Variables: AuthedVariables }> {
  return async (c, next) => {
    if (!roles.includes(c.get('user').role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  };
}
