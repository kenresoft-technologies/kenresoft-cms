import type { Database } from '@kenresoft/database';
import type { MiddlewareHandler } from 'hono';

import { getDb } from '../lib/db';
import { getSessionById } from '../repositories/sessions';
import type { Bindings } from '../lib/env';
import type { AuthedVariables } from './require-session';

// better-auth's own session freshness (session.freshAge) is a ~24h activity window, not
// "recently re-entered your password" — an actively-used session stays "fresh" almost
// indefinitely, so it isn't fit for step-up re-auth. This is a separate, narrower concept:
// POST /api/v1/admin/security/elevate sets elevatedUntil on this exact session row after a
// fresh password check, and it naturally expires a few minutes later. Scoped per-session
// (device), not globally on the user, matching how session already models per-device state.
export async function isSessionElevated(db: Database, sessionId: string): Promise<boolean> {
  const currentSession = await getSessionById(db, sessionId);
  return Boolean(currentSession?.elevatedUntil && currentSession.elevatedUntil.getTime() > Date.now());
}

// For routes where elevation is required unconditionally (ownership transfer) — routes where
// it's only required in some branches (disabling a user, only when the target is an admin) call
// isSessionElevated() directly instead of using this middleware.
export const requireElevatedSession: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AuthedVariables;
}> = async (c, next) => {
  const db = getDb(c);
  const session = c.get('session');
  if (!(await isSessionElevated(db, session.id))) {
    return c.json({ error: 'Re-enter your password to continue' }, 403);
  }
  await next();
};
