import { createRoute } from '@hono/zod-openapi';
import {
  adminUserSchema,
  createdUserSchema,
  createUserSchema,
  idParamSchema,
  sessionSchema,
  updateUserDeveloperToolsAccessSchema,
  updateUserDisabledSchema,
  updateUserRoleSchema,
} from '@kenresoft-cms/contracts';
import type { AdminUser, Session, UserRole } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { createAuth } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { checkGuardianRemains, checkNotTargetingOwner } from '../../lib/user-guards';
import { isSessionElevated } from '../../middleware/require-elevated-session';
import { requireRole } from '../../middleware/require-role';
import {
  deleteUser,
  getUserByEmail,
  getUserById,
  listUsersWithLastActive,
  updateUserDeveloperToolsAccess,
  updateUserDisabled,
  updateUserRole,
} from '../../repositories/users';
import {
  deleteAllSessionsForUser,
  deleteSession,
  getSessionById,
  listSessionsForUser,
} from '../../repositories/sessions';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { Session as DbSession } from '../../repositories/sessions';

export const usersRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const sessionParamSchema = z.object({ id: z.string().min(1), sessionId: z.string().min(1) });

function toSession(row: DbSession): Session {
  return {
    id: row.id,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

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
      disabled: user.disabled,
      developerToolsAccess: user.developerToolsAccess,
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

// Admin-only, same as role changes. There's no email sending configured (§9), so this can't
// be a real invite-by-link flow — it creates the account directly via better-auth's own
// sign-up (the same internal call the public /sign-up/email route makes) with a random
// temporary password, returned once for the admin to share with the new user out-of-band.
// New signups already default to 'editor' (src/lib/auth.ts's bootstrap hook only grants
// 'admin' to a literal first-ever signup) — an admin can promote or reassign them afterward
// via the existing role control.
usersRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Users'],
    summary: 'Create a user with a temporary password (admin only)',
    middleware: requireRole('admin'),
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
        content: { 'application/json': { schema: notFoundSchema } },
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
      disabled: false,
      developerToolsAccess: false,
      createdAt: new Date(result.user.createdAt).toISOString(),
      lastActiveAt: null,
    };
    return c.json({ user: response, temporaryPassword }, 201);
  },
);

// Role changes are admin-only. An owner is never a valid target here (ownership only moves
// through Transfer ownership) — that's checked before anything else, so an admin trying to
// "demote" an owner gets rejected outright rather than silently succeeding at nothing. Beyond
// that, reject any change that would leave the deployment with zero guardians (owner + admin
// combined) — a strict superset of "can't demote yourself," since it also covers an admin
// demoting the last other admin.
usersRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/role',
    tags: ['Users'],
    summary: "Update a user's role (admin only)",
    middleware: requireRole('admin'),
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
        content: { 'application/json': { schema: notFoundSchema } },
      },
      400: {
        description: 'The change would leave the deployment with no owner or admin.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      403: {
        description: 'The target is the owner — role changes must go through Transfer ownership.',
        content: { 'application/json': { schema: notFoundSchema } },
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

    const targetRole = target.role as UserRole;
    const ownerCheck = checkNotTargetingOwner({ role: targetRole });
    if (!ownerCheck.ok) {
      return c.json({ error: ownerCheck.error }, ownerCheck.status);
    }

    const { role } = c.req.valid('json');

    if (role === 'owner') {
      return c.json({ error: 'Granting ownership must go through Transfer ownership' }, 403);
    }

    // targetRole can't be 'owner' here — checkNotTargetingOwner above already rejected that.
    if (targetRole === 'admin' && role !== 'admin') {
      const guardianCheck = await checkGuardianRemains(db, target.id);
      if (!guardianCheck.ok) {
        return c.json({ error: guardianCheck.error }, guardianCheck.status);
      }
    }

    const updated = await updateUserRole(db, target.id, role);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'user.role_changed',
      targetType: 'user',
      targetId: target.id,
      metadata: { previousRole: targetRole, newRole: role },
    });
    // updateUserRole's plain update-returning row has no lastActiveAt (that's a computed
    // join in listUsersWithLastActive, not a column) — null is the honest value here, same
    // as the admin's onSuccess handler already ignores this field and refetches the list.
    const response: AdminUser = {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role as UserRole,
      disabled: updated.disabled,
      developerToolsAccess: updated.developerToolsAccess,
      createdAt: updated.createdAt.toISOString(),
      lastActiveAt: null,
    };
    return c.json(response, 200);
  },
);

// Admin-only. An owner can never be deleted through this route (checkNotTargetingOwner).
// Blocks the same "would leave zero guardians" case as the role-change route above, plus
// removing your own account through this control specifically — self-removal is a different,
// more deliberate action than this button, and not one this admin exposes yet.
usersRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Users'],
    summary: 'Delete a user (admin only)',
    middleware: requireRole('admin'),
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The user was deleted.' },
      404: {
        description: 'No user with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      400: {
        description: 'Deleting this user would leave the deployment with no owner or admin, or is your own account.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      403: {
        description: 'The target is the owner.',
        content: { 'application/json': { schema: notFoundSchema } },
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

    const ownerCheck = checkNotTargetingOwner({ role: target.role as UserRole });
    if (!ownerCheck.ok) {
      return c.json({ error: ownerCheck.error }, ownerCheck.status);
    }

    const actingUser = c.get('user');
    if (target.id === actingUser.id) {
      return c.json({ error: 'You cannot remove your own account here' }, 400);
    }

    if (target.role === 'admin') {
      const guardianCheck = await checkGuardianRemains(db, target.id);
      if (!guardianCheck.ok) {
        return c.json({ error: guardianCheck.error }, guardianCheck.status);
      }
    }

    await deleteUser(db, target.id);
    await recordAudit(db, {
      actorUserId: actingUser.id,
      action: 'user.deleted',
      targetType: 'user',
      targetId: target.id,
      metadata: { role: target.role },
    });
    return c.body(null, 204);
  },
);

// Admin-only. Owner can't be disabled through this route. Disabling an admin requires a fresh
// re-auth (requireElevatedSession) — a compromised admin session shouldn't be enough on its own
// to lock out another admin, and disabling revokes every one of that user's existing sessions
// immediately rather than waiting for requireSession's own disabled check to catch them on
// their next request.
usersRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/disabled',
    tags: ['Users'],
    summary: "Enable or disable a user's account (admin only)",
    middleware: requireRole('admin'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateUserDisabledSchema } } },
    },
    responses: {
      200: {
        description: 'The updated user.',
        content: { 'application/json': { schema: adminUserSchema } },
      },
      404: {
        description: 'No user with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      400: {
        description: 'Disabling this user would leave the deployment with no owner or admin.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      403: {
        description: 'The target is the owner, or disabling an admin requires a fresh re-authentication.',
        content: { 'application/json': { schema: notFoundSchema } },
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

    const ownerCheck = checkNotTargetingOwner({ role: target.role as UserRole });
    if (!ownerCheck.ok) {
      return c.json({ error: ownerCheck.error }, ownerCheck.status);
    }

    const { disabled } = c.req.valid('json');

    if (disabled) {
      if (target.role === 'admin') {
        if (!(await isSessionElevated(db, c.get('session').id))) {
          return c.json({ error: 'Re-enter your password to disable an administrator' }, 403);
        }

        const guardianCheck = await checkGuardianRemains(db, target.id);
        if (!guardianCheck.ok) {
          return c.json({ error: guardianCheck.error }, guardianCheck.status);
        }
      }
      await deleteAllSessionsForUser(db, target.id);
    }

    const updated = await updateUserDisabled(db, target.id, disabled);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: disabled ? 'user.disabled' : 'user.enabled',
      targetType: 'user',
      targetId: target.id,
    });
    const response: AdminUser = {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role as UserRole,
      disabled: updated.disabled,
      developerToolsAccess: updated.developerToolsAccess,
      createdAt: updated.createdAt.toISOString(),
      lastActiveAt: null,
    };
    return c.json(response, 200);
  },
);

// Admin-only, but deliberately not elevation-gated like disabling an admin — granting this only
// exposes public-API-consumption reference material (endpoints, field shapes, copyable client
// snippets), not database secrets, so it doesn't carry the same blast radius as a role or
// disabled change. Owner/admin already see the Developer panel unconditionally whenever the
// deployment-wide flag is on (apps/admin/src/lib/developer-mode.ts) regardless of this column —
// this route exists so an admin can extend that same visibility to a specific editor or author
// without raising their role.
usersRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/developer-tools-access',
    tags: ['Users'],
    summary: "Grant or revoke a user's per-user Developer panel access (admin only)",
    middleware: requireRole('admin'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateUserDeveloperToolsAccessSchema } } },
    },
    responses: {
      200: {
        description: 'The updated user.',
        content: { 'application/json': { schema: adminUserSchema } },
      },
      404: {
        description: 'No user with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
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

    const { developerToolsAccess } = c.req.valid('json');
    const updated = await updateUserDeveloperToolsAccess(db, target.id, developerToolsAccess);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: developerToolsAccess ? 'user.developer_tools_granted' : 'user.developer_tools_revoked',
      targetType: 'user',
      targetId: target.id,
    });
    const response: AdminUser = {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role as UserRole,
      disabled: updated.disabled,
      developerToolsAccess: updated.developerToolsAccess,
      createdAt: updated.createdAt.toISOString(),
      lastActiveAt: null,
    };
    return c.json(response, 200);
  },
);

// Admin-only — session monitoring (which device/IP a user is signed in from, and when they
// were last active) is an administrative concern, same tier as the user list itself.
usersRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/sessions',
    tags: ['Users'],
    summary: "List a user's active sessions (admin only)",
    middleware: requireRole('admin'),
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Every session currently valid for this user, most recently active first.',
        content: { 'application/json': { schema: z.array(sessionSchema) } },
      },
      404: {
        description: 'No user with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
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

    const sessions = await listSessionsForUser(db, id);
    return c.json(sessions.map(toSession), 200);
  },
);

// Admin-only. Deleting the row is enough to end the session immediately (repositories/
// sessions.ts) — no separate "logged out" state to reconcile.
usersRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/sessions/{sessionId}',
    tags: ['Users'],
    summary: "Revoke one of a user's sessions (admin only)",
    middleware: requireRole('admin'),
    request: { params: sessionParamSchema },
    responses: {
      204: { description: 'The session was revoked.' },
      404: {
        description: 'No user or session matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, sessionId } = c.req.valid('param');
    const db = getDb(c);
    const target = await getSessionById(db, sessionId);
    if (!target || target.userId !== id) {
      return c.json({ error: 'Session not found' }, 404);
    }

    await deleteSession(db, sessionId);
    return c.body(null, 204);
  },
);
