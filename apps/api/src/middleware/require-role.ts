import { ROLE_RANK } from '@kenresoft/contracts';
import type { MiddlewareHandler } from 'hono';

import type { Bindings } from '../lib/env';
import type { AuthedVariables, Role } from './require-session';

// Treats its arguments as "this rank or above," not an exact set — safe because every call
// site in this codebase already passes a contiguous top slice of the role hierarchy (verified:
// every requireRole() call across routes/admin/* is either ('admin') or ('admin', 'editor'),
// never a non-contiguous set like ('admin', 'viewer')). This is what let 'owner' slot in above
// 'admin' without touching any of the ~19 existing call sites — they all still mean "admin or
// above," and owner now satisfies that automatically via ROLE_RANK.
export function requireRole(
  ...roles: Role[]
): MiddlewareHandler<{ Bindings: Bindings; Variables: AuthedVariables }> {
  const minRank = Math.min(...roles.map((role) => ROLE_RANK[role]));
  return async (c, next) => {
    if (ROLE_RANK[c.get('user').role] < minRank) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  };
}
