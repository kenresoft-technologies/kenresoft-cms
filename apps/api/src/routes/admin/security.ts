import { createRoute } from '@hono/zod-openapi';
import {
  adminUserSchema,
  elevateSchema,
  recoveryCodesGeneratedSchema,
  recoveryCodesStatusSchema,
  transferOwnershipSchema,
} from '@kenresoft-cms/contracts';
import type { AdminUser, UserRole } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { createAuth } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireElevatedSession } from '../../middleware/require-elevated-session';
import { requireRole } from '../../middleware/require-role';
import { countUnusedRecoveryCodes, replaceRecoveryCodes } from '../../repositories/recovery-codes';
import { getUserById, updateUserRoleQuery } from '../../repositories/users';
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
        description: 'Cannot transfer ownership to yourself or to a disabled account.',
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
    if (target.disabled) {
      return c.json({ error: 'Cannot transfer ownership to a disabled account' }, 400);
    }

    // A single D1 batch, not two independently-awaited statements — D1 runs a batch as one
    // atomic unit (all statements succeed or none do), so there's never a window where the
    // acting user has already been demoted but the target hasn't yet become owner (or vice
    // versa) if the second statement were to fail on its own.
    const [, [newOwnerRow]] = await db.batch([
      updateUserRoleQuery(db, actingUser.id, 'admin'),
      updateUserRoleQuery(db, target.id, 'owner'),
    ]);
    // update...where(id).returning() always yields exactly one row for an id that existed a
    // moment ago (getUserById already confirmed target exists) — same non-null assertion
    // updateUserRole() itself uses for the identical shape.
    const newOwner = newOwnerRow!;
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
      developerToolsAccess: newOwner.developerToolsAccess,
      createdAt: newOwner.createdAt.toISOString(),
      lastActiveAt: null,
    };
    return c.json(response, 200);
  },
);

// How many of the current owner's recovery codes (docs/ARCHITECTURE.md's recovery section)
// haven't been redeemed yet — lets the Settings UI show "8 codes remaining" without ever
// re-displaying a code. Owner-only, but no elevation requirement: this only reveals a count,
// not the codes themselves.
securityRoute.openapi(
  createRoute({
    method: 'get',
    path: '/recovery-codes',
    tags: ['Security'],
    summary: "Get the number of the caller's unused recovery codes (owner only)",
    middleware: requireRole('owner'),
    responses: {
      200: {
        description: 'How many recovery codes remain unused.',
        content: { 'application/json': { schema: recoveryCodesStatusSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const remaining = await countUnusedRecoveryCodes(db, c.get('user').id);
    return c.json({ remaining }, 200);
  },
);

// Regenerating always fully replaces the set (apps/api/src/repositories/recovery-codes.ts) —
// every previous code stops working, which doubles as "revoke." Elevation-gated like
// ownership transfer: these codes can reset the owner's password without email access, so
// minting a fresh batch is exactly as sensitive as changing the password directly.
securityRoute.openapi(
  createRoute({
    method: 'post',
    path: '/recovery-codes/generate',
    tags: ['Security'],
    summary: "Generate a fresh set of the caller's recovery codes, invalidating any existing ones (owner only)",
    middleware: [requireRole('owner'), requireElevatedSession],
    responses: {
      200: {
        description: 'The new codes, in plaintext — shown exactly once and never stored as such.',
        content: { 'application/json': { schema: recoveryCodesGeneratedSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const actingUser = c.get('user');
    const codes = await replaceRecoveryCodes(db, actingUser.id);
    await recordAudit(db, { actorUserId: actingUser.id, action: 'recovery-codes.generated', targetType: 'user', targetId: actingUser.id });
    return c.json({ codes }, 200);
  },
);

// Revoke without regenerating — for "I think these leaked" without wanting new ones yet.
securityRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/recovery-codes',
    tags: ['Security'],
    summary: "Revoke all of the caller's recovery codes without replacing them (owner only)",
    middleware: [requireRole('owner'), requireElevatedSession],
    responses: {
      200: {
        description: 'All recovery codes revoked.',
        content: { 'application/json': { schema: z.object({ revoked: z.boolean() }) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const actingUser = c.get('user');
    await replaceRecoveryCodes(db, actingUser.id, 0);
    await recordAudit(db, { actorUserId: actingUser.id, action: 'recovery-codes.revoked', targetType: 'user', targetId: actingUser.id });
    return c.json({ revoked: true }, 200);
  },
);
