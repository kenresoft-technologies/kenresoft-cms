import type { UserRole } from '@kenresoft-cms/contracts';
import type { MiddlewareHandler } from 'hono';

import { createAuth } from '../lib/auth';
import type { Bindings } from '../lib/env';

// Re-exported under the old name so every existing `import type { Role } from
// './require-session'` call site (requireRole's call sites, mainly) keeps working unchanged —
// the single source of truth for the union itself is now @kenresoft-cms/contracts' UserRole.
export type Role = UserRole;

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  disabled: boolean;
}

// Exposes the session id (not the token) so route handlers can act on "this specific device's
// session" — currently just elevation (require-elevated-session.ts sets/reads elevatedUntil on
// this exact row), deliberately not the user's session list as a whole.
export type AuthedVariables = { user: SessionUser; session: { id: string } };

export const requireSession: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AuthedVariables;
}> = async (c, next) => {
  const auth = createAuth(c.env);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!result) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // A disabled account is treated as unauthenticated for every practical purpose — disabling
  // also proactively revokes all of that user's sessions (repositories/sessions.ts) as
  // defense-in-depth, but this check is what actually enforces it if that ever lagged.
  if (result.user.disabled) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // better-auth types "role"/"disabled" as plain string/boolean additionalFields — the cast
  // narrows to what auth.ts's owner-bootstrap hook and the schema defaults actually ever assign.
  c.set('user', result.user as SessionUser);
  c.set('session', { id: result.session.id });
  await next();
};
