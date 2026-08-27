import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { parseJsonBody } from '../../lib/validate';
import { requireRole } from '../../middleware/require-role';
import { countOwners, getUserById, listUsersWithLastActive, updateUserRole } from '../../repositories/users';
import { updateUserRoleSchema } from '../../validators/users';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const usersRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

usersRoute.get('/', async (c) => {
  const db = getDb(c);
  return c.json(await listUsersWithLastActive(db));
});

// Role changes are owner-only. Beyond that, reject any change that would leave the
// deployment with zero owners — a strict superset of "can't demote yourself," since it also
// covers an owner demoting the last other owner.
usersRoute.patch('/:id/role', requireRole('owner'), async (c) => {
  const db = getDb(c);
  const target = await getUserById(db, c.req.param('id'));
  if (!target) {
    return c.json({ error: 'User not found' }, 404);
  }

  const parsed = await parseJsonBody(c, updateUserRoleSchema);
  if ('error' in parsed) return parsed.error;

  if (target.role === 'owner' && parsed.data.role !== 'owner') {
    const ownerCount = await countOwners(db);
    if (ownerCount <= 1) {
      return c.json({ error: 'Cannot remove the last remaining owner' }, 400);
    }
  }

  const updated = await updateUserRole(db, target.id, parsed.data.role);
  return c.json(updated);
});
