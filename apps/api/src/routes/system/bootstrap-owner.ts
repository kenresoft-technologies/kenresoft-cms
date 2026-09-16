import { createRoute } from '@hono/zod-openapi';
import { constantTimeEqual } from 'better-auth/crypto';
import { eq, user } from '@kenresoft-cms/database';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { createAuth } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import {
  claimBootstrapToken,
  consumeBootstrapToken,
  getPendingBootstrapToken,
  hasAnyUser,
} from '../../repositories/installation-bootstrap';
import { updateUserRole } from '../../repositories/users';
import type { Bindings } from '../../lib/env';

export const bootstrapRoute = createOpenApiApp<{ Bindings: Bindings }>();

const BOOTSTRAP_TOKEN_TTL_MS = 30 * 60 * 1000;

function generateBootstrapToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const errorSchema = z.object({ error: z.string() });
const requestedSchema = z.object({ message: z.string() });
const completeSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(200),
});
const completedSchema = z.object({ message: z.string(), email: z.string() });

// Step 1 of the secure first-owner bootstrap (docs/ARCHITECTURE.md §10): a fresh installation
// has zero users and no owner, and ordinary public signup must never be able to claim that role
// (see lib/auth.ts, which no longer grants "owner" to a bare first signup). This generates a
// one-time token, hashes it at rest, and logs the PLAINTEXT token to this Worker's own console
// (visible via `wrangler tail`/`wrangler dev`) — never in the HTTP response — so only someone
// with access to this deployment's own logs can retrieve it. Mirrors the noop email sender's
// "log what would be sent" convention, already used for exactly this class of problem
// (avoiding a bootstrap-owner exception, per the Changelog). 404s outright once any user
// exists — a completed installation has no further use for this route and should be
// indistinguishable from one that never existed to anyone probing it afterward.
bootstrapRoute.openapi(
  createRoute({
    method: 'post',
    path: '/bootstrap/request',
    tags: ['System'],
    summary: 'Request a one-time first-owner bootstrap token (uninitialized installations only)',
    responses: {
      202: {
        description: "A bootstrap token was generated (or one is already pending) — check this deployment's own server logs.",
        content: { 'application/json': { schema: requestedSchema } },
      },
      404: {
        description: 'This installation is already initialized.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    if (await hasAnyUser(db)) {
      return c.json({ error: 'Not found' }, 404);
    }

    const pending = await getPendingBootstrapToken(db);
    if (!pending || pending.expiresAt.getTime() < Date.now()) {
      const token = generateBootstrapToken();
      const tokenHash = await hashToken(token);
      await claimBootstrapToken(db, tokenHash, new Date(Date.now() + BOOTSTRAP_TOKEN_TTL_MS));
      // Deliberately the only place this plaintext value ever exists — never persisted, never
      // returned over HTTP. Visible only via this Worker's own logs.
      console.log(`[installation-bootstrap] First-owner bootstrap token (expires in 30 minutes): ${token}`);
    }

    return c.json(
      {
        message: "A bootstrap token has been generated. Check this deployment's server logs (wrangler tail / wrangler dev output) to retrieve it.",
      },
      202,
    );
  },
);

// Step 2: redeems the token from step 1 to create this deployment's one and only bootstrap-path
// owner account. One-time — the token row is marked used via a single conditional UPDATE, so
// two concurrent redemptions of the same token can't both succeed — and expiring (30 minutes).
// Skips the normal email-verification gate (lib/auth.ts) for this one account specifically:
// proving possession of a token that only ever appeared in this deployment's own server logs is
// at least as strong a proof of legitimate operator access as an email round trip, and
// requiring verification here would make bootstrap impossible on a deployment with no email
// provider configured yet.
bootstrapRoute.openapi(
  createRoute({
    method: 'post',
    path: '/bootstrap/complete',
    tags: ['System'],
    summary: 'Redeem a bootstrap token to create the first owner account',
    request: {
      body: { content: { 'application/json': { schema: completeSchema } } },
    },
    responses: {
      201: {
        description: 'The first owner account was created.',
        content: { 'application/json': { schema: completedSchema } },
      },
      400: {
        description: 'The token is invalid, expired, already used, or the email is already taken.',
        content: { 'application/json': { schema: errorSchema } },
      },
      404: {
        description: 'This installation is already initialized.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    if (await hasAnyUser(db)) {
      return c.json({ error: 'Not found' }, 404);
    }

    const { token, email, password, name } = c.req.valid('json');
    const pending = await getPendingBootstrapToken(db);
    if (!pending || pending.expiresAt.getTime() < Date.now()) {
      return c.json({ error: 'Invalid or expired bootstrap token' }, 400);
    }

    const tokenHash = await hashToken(token);
    if (!constantTimeEqual(tokenHash, pending.tokenHash)) {
      return c.json({ error: 'Invalid or expired bootstrap token' }, 400);
    }

    // Consumed via a conditional update keyed on still being unused — the same
    // conditional-update-plus-check-returned-rows idiom this codebase already uses everywhere a
    // token/reservation must only ever be claimed once (recovery codes, payment idempotency
    // keys, single-use verification tokens).
    const consumed = await consumeBootstrapToken(db, pending.id);
    if (!consumed) {
      return c.json({ error: 'Invalid or expired bootstrap token' }, 400);
    }

    // hasAnyUser() above and this call are not atomic, but that race is closed by the
    // single-use token consumption above — only one concurrent /bootstrap/complete call can
    // ever reach this point holding a successfully consumed token.
    let newUser: { id: string; email: string };
    try {
      const result = await createAuth(c.env, c.executionCtx).api.signUpEmail({
        body: { name, email, password },
      });
      newUser = result.user as unknown as { id: string; email: string };
    } catch {
      return c.json({ error: 'Could not create the account — the email may already be in use' }, 400);
    }

    await updateUserRole(db, newUser.id, 'owner');
    // Bypasses requireEmailVerification for this one bootstrap-created account (see comment
    // above) — better-auth's own emailVerified column, set directly, not via its own
    // verification-token flow.
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, newUser.id));

    await recordAudit(db, {
      actorUserId: newUser.id,
      action: 'auth.sign_up',
      targetType: 'user',
      targetId: newUser.id,
      metadata: { bootstrap: true },
    });

    return c.json({ message: 'Owner account created. Sign in with your new credentials.', email: newUser.email }, 201);
  },
);
