import { createRoute } from '@hono/zod-openapi';
import {
  adminUserSchema,
  createdUserSchema,
  createUserSchema,
  idParamSchema,
  updateUserRoleSchema,
} from '@kenresoft/contracts';
import type { AdminUser, UserRole } from '@kenresoft/contracts';
import { z } from 'zod';

import { createAuth } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import {
  countOwners,
  deleteUser,
  getUserByEmail,
  getUserById,
  listUsersWithLastActive,
  updateUserRole,
} from '../../repositories/users';
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

function generateTemporaryPassword(): string {
  // 18 random bytes, base64url-encoded (no padding/slashes to fumble when read aloud or
  // pasted) — well above better-auth's default minimum length.
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

// Owner-only, same as role changes. There's no email sending configured (§9), so this can't
// be a real invite-by-link flow — it creates the account directly via better-auth's own
// sign-up (the same internal call the public /sign-up/email route makes) with a random
// temporary password, returned once for the owner to share with the new user out-of-band.
// New signups already default to 'editor' (src/lib/auth.ts's bootstrap hook only grants
// 'owner' to a literal first-ever signup) — an owner can promote them afterward via the
// existing role control.
usersRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Users'],
    summary: 'Create a user with a temporary password (owner only)',
    middleware: requireRole('owner'),
    request: {
      body: { content: { 'application/json': { schema: createUserSchema } } },
    },
    responses: {
      201: {
        description: 'The created user and their one-time temporary password.',
        content: { 'application/json': { schema: createdUserSchema } },
      },
      400: {
        description: 'A user with that email already exists, or the input was invalid.',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { name, email } = c.req.valid('json');
    const db = getDb(c);

    // Checked up front rather than relying on signUpEmail's own duplicate-email rejection —
    // that error surfaces through an internal path in better-auth that also logs it as a
    // second, detached promise rejection outside whatever awaits the call (reproduced
    // reliably in tests as an "unhandled rejection" even though a try/catch around the call
    // itself worked fine and returned the right status). Checking first avoids ever
    // triggering that path for the one realistic failure mode this route has — email
    // format and password strength are already handled by our own schema and the generated
    // password respectively.
    const existing = await getUserByEmail(db, email);
    if (existing) {
      return c.json({ error: 'A user with that email already exists' }, 400);
    }

    const temporaryPassword = generateTemporaryPassword();
    const result = await createAuth(c.env).api.signUpEmail({
      body: { name, email, password: temporaryPassword },
    });
    const response: AdminUser = {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      // better-auth types the "role" additionalField as plain string (§ same note above on
      // adminUserSchema) — always present in practice via the schema default.
      role: result.user.role as UserRole,
      createdAt: new Date(result.user.createdAt).toISOString(),
      lastActiveAt: null,
    };
    return c.json({ user: response, temporaryPassword }, 201);
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

// Owner-only. Blocks the same "would leave zero owners" case as the role-change route above,
// plus removing your own account through this control specifically — self-removal is a
// different, more deliberate action than this button, and not one this admin exposes yet.
usersRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Users'],
    summary: 'Delete a user (owner only)',
    middleware: requireRole('owner'),
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The user was deleted.' },
      404: {
        description: 'No user with that id.',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      400: {
        description: 'Deleting this user would leave the deployment with zero owners, or is your own account.',
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

    const actingUser = c.get('user');
    if (target.id === actingUser.id) {
      return c.json({ error: 'You cannot remove your own account here' }, 400);
    }

    if (target.role === 'owner') {
      const ownerCount = await countOwners(db);
      if (ownerCount <= 1) {
        return c.json({ error: 'Cannot remove the last remaining owner' }, 400);
      }
    }

    await deleteUser(db, target.id);
    return c.body(null, 204);
  },
);
