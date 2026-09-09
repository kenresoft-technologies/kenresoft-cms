import { roleAtLeast } from '@kenresoft-cms/contracts/schemas/enums';
import type { UserRole } from '@kenresoft-cms/contracts/schemas/enums';
import type { MiddlewareHandler } from 'hono';

import type { PluginBindings, PluginVariables } from './context';

// Mirrors apps/api/src/middleware/require-role.ts's exact idiom, rebuilt from the same
// roleAtLeast()/UserRole primitives rather than importing requireRole itself — a plugin package
// must never have a dependency edge into an app's src/, only the reverse. Phase 1 permission
// enforcement reuses Core's existing role hierarchy wholesale; manifest.permissions stays
// documentation/discovery metadata only (docs/PLUGINS.md) — inventing a parallel granular
// enforcement engine for a hello-world action would be exactly the speculative refactor this
// platform's own design principles warn against.
export function requirePluginRole(
  minimum: UserRole,
): MiddlewareHandler<{ Bindings: PluginBindings; Variables: PluginVariables }> {
  return async (c, next) => {
    if (!roleAtLeast(c.get('user').role, minimum)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  };
}
