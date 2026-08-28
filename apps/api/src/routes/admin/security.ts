import { createRoute } from '@hono/zod-openapi';
import { adminUserSchema, elevateSchema, transferOwnershipSchema } from '@kenresoft/contracts';
import type { AdminUser, UserRole } from '@kenresoft/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { createAuth } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireElevatedSession } from '../../middleware/require-elevated-session';
import { requireRole } from '../../middleware/require-role';
import { getUserById, updateUserRole } from '../../repositories/users';
import { setSessionElevatedUntil } from '../../repositories/sessions';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const securityRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const errorSchema = z.object({ error: z.string() });
const elevateResponseSchema = z.object({ elevated: z.boolean() });

const ELEVATION_DURATION_MS = 5 * 60 * 1000;

// Any authenticated user may re-verify their own password — this doesn't grant anything by
// itself, it only unlocks whatever elevation-gated action the caller goes on to attempt
// (ownership transfer, disabling an admin), each of which still enforces its own role check
// independently. Scoped to this one session row/device, not the user globally.
securityRoute.openapi(
  createRoute({
    method: 'post',
    path: '/elevate',
    tags: ['Security'],
    summary: "Re-verify the caller's password to unlock sensitive actions for a few minutes",
    request: {
      body: { content: { 'application/json': { schema: elevateSchema } } },
    },
    responses: {
      200: {
        description: 'Elevated for the next few minutes, scoped to this session.',
        content: { 'application/json': { schema: elevateResponseSchema } },
      },
      403: {
        description: 'Incorrect password.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { password } = c.req.valid('json');

    // verifyPassword throws on an incorrect password (or, in principle, an already-invalid
    // session — moot here since requireSession already validated it moments earlier in the
    // same request's middleware chain) — either way, the caller just isn't elevated.
    try {
      await createAuth(c.env).api.verifyPassword({
        headers: c.req.raw.headers,
        body: { password },
      });
    } catch {
      return c.json({ error: 'Incorrect password' }, 403);
    }

    const db = getDb(c);
    const session = c.get('session');
    await setSessionElevatedUntil(db, session.id, new Date(Date.now() + ELEVATION_DURATION_MS));
    return c.json({ elevated: true }, 200);
  },
);

// Owner-only, and requires a fresh elevation on top of that — the highest-consequence action
// in the whole role model, so both gates apply rather than either alone. A swap, not a grant:
// the caller relinquishes owner (becomes admin) exactly as the target gains it, so there's
// never a moment with zero owners or two owners, and no separate guardian check is needed.
securityRoute.openapi(
  createRoute({
    method: 'post',
    path: '/ownership/transfer',
    tags: ['Security'],
    summary: 'Transfer ownership of this installation to another user (owner only)',
    middleware: [requireRole('owner'), requireElevatedSession],
    request: {
      body: { content: { 'application/json': { schema: transferOwnershipSchema } } },
    },
    responses: {
      200: {
        description: 'The new owner.',
        content: { 'application/json': { schema: adminUserSchema } },
      },
      404: {
        description: 'No user with that id.',
        content: { 'application/json': { schema: errorSchema } },
      },
      400: {
        description: 'Cannot transfer ownership to yourself.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { targetUserId } = c.req.valid('json');
    const db = getDb(c);
    const actingUser = c.get('user');

    if (targetUserId === actingUser.id) {
      return c.json({ error: 'You already own this installation' }, 400);
    }

    const target = await getUserById(db, targetUserId);
    if (!target) {
      return c.json({ error: 'User not found' }, 404);
    }

    await updateUserRole(db, actingUser.id, 'admin');
    const newOwner = await updateUserRole(db, target.id, 'owner');
    await recordAudit(db, {
      actorUserId: actingUser.id,
      action: 'ownership.transferred',
      targetType: 'user',
      targetId: target.id,
      metadata: { previousOwnerId: actingUser.id },
    });

    const response: AdminUser = {
      id: newOwner.id,
      name: newOwner.name,
      email: newOwner.email,
      role: newOwner.role as UserRole,
      disabled: newOwner.disabled,
      createdAt: newOwner.createdAt.toISOString(),
      lastActiveAt: null,
    };
    return c.json(response, 200);
  },
);
