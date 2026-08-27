import { createRoute } from '@hono/zod-openapi';
import { adminUserSchema, idParamSchema, updateUserRoleSchema } from '@kenresoft/contracts';
import type { AdminUser, UserRole } from '@kenresoft/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import { countOwners, getUserById, listUsersWithLastActive, updateUserRole } from '../../repositories/users';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const usersRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

usersRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Users'],
    summary: 'List every user with their role and last-active time',
    responses: {
      200: {
        description: 'Every user with access to this deployment.',
        content: { 'application/json': { schema: z.array(adminUserSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const users = await listUsersWithLastActive(db);
    const response: AdminUser[] = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      // The repository's role column is plain `string` at the Drizzle layer (untyped text
      // column) — narrowed here to the contract's literal union, which the DB constraint
      // (bootstrap hook + this very route) already guarantees in practice.
      role: user.role as UserRole,
      createdAt: user.createdAt.toISOString(),
      lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
    }));
    return c.json(response);
  },
);

// Role changes are owner-only. Beyond that, reject any change that would leave the
// deployment with zero owners — a strict superset of "can't demote yourself," since it also
// covers an owner demoting the last other owner.
usersRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/role',
    tags: ['Users'],
    summary: "Update a user's role (owner only)",
    middleware: requireRole('owner'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateUserRoleSchema } } },
    },
    responses: {
      200: {
        description: 'The updated user.',
        content: { 'application/json': { schema: adminUserSchema } },
      },
      404: {
        description: 'No user with that id.',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      400: {
        description: 'The change would leave the deployment with zero owners.',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const target = await getUserById(db, id);
    if (!target) {
      return c.json({ error: 'User not found' }, 404);
    }

    const { role } = c.req.valid('json');

    if (target.role === 'owner' && role !== 'owner') {
      const ownerCount = await countOwners(db);
      if (ownerCount <= 1) {
        return c.json({ error: 'Cannot remove the last remaining owner' }, 400);
      }
    }

    const updated = await updateUserRole(db, target.id, role);
    // updateUserRole's plain update-returning row has no lastActiveAt (that's a computed
    // join in listUsersWithLastActive, not a column) — null is the honest value here, same
    // as the admin's onSuccess handler already ignores this field and refetches the list.
    const response: AdminUser = {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role as UserRole,
      createdAt: updated.createdAt.toISOString(),
      lastActiveAt: null,
    };
    return c.json(response, 200);
  },
);
