import { createRoute } from '@hono/zod-openapi';
import { constantTimeEqual, hashPassword } from 'better-auth/crypto';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { getCredentialAccount, updateAccountPassword } from '../../repositories/accounts';
import { deleteAllSessionsForUser } from '../../repositories/sessions';
import { getUserByEmail } from '../../repositories/users';
import type { Bindings } from '../../lib/env';

export const systemRoute = createOpenApiApp<{ Bindings: Bindings }>();

const requestSchema = z.object({
  secret: z.string().min(1),
  email: z.string().email(),
  newPassword: z.string().min(8).max(200),
});
const errorSchema = z.object({ error: z.string() });
const successSchema = z.object({ message: z.string() });
const statusSchema = z.object({ emailConfigured: z.boolean() });

// Unauthenticated by design — this is deployment-wide, not per-account, so it carries none of
// the account-enumeration risk that keeps /public/password-reset/request's response generic
// regardless of input. Lets ForgotPasswordPage/RecoverWithCodePage tell someone up front that
// password-reset email can't actually be delivered on this deployment (EMAIL_PROVIDER unset),
// rather than them clicking "Send reset link" and waiting on an email that was never going to
// arrive. docs/DEPLOYMENT.md's recovery section has the setup steps for enabling real delivery.
systemRoute.openapi(
  createRoute({
    method: 'get',
    path: '/status',
    tags: ['System'],
    summary: 'Deployment-wide feature availability (currently just email delivery)',
    responses: {
      200: {
        description: 'Whether this deployment has a real email provider configured.',
        content: { 'application/json': { schema: statusSchema } },
      },
    },
  }),
  (c) => {
    const emailConfigured = c.env.EMAIL_PROVIDER === 'cloudflare' || c.env.EMAIL_PROVIDER === 'resend';
    return c.json({ emailConfigured }, 200);
  },
);

// The break-glass path for "every admin/owner account is locked out and no one has server
// access to run the CLI recovery script" (docs/ARCHITECTURE.md's recovery section) — the other
// owner-recovery mechanism, apps/api/scripts/recover-owner.mjs, is preferred whenever real
// deployment-environment access is available, since it needs no standing secret at all. This
// endpoint 404s outright when OWNER_RECOVERY_SECRET isn't set (checked before anything else,
// including rate limiting), so an installation that hasn't explicitly opted in via
// `wrangler secret put OWNER_RECOVERY_SECRET` exposes zero additional attack surface — the
// route is indistinguishable from one that doesn't exist. No hidden Kenresoft-held secret
// makes this work: the secret lives only in this one deployment's own Worker secrets.
systemRoute.openapi(
  createRoute({
    method: 'post',
    path: '/recover-owner',
    tags: ['System'],
    summary: 'Emergency owner password reset, gated by a deployment-local secret',
    description:
      'Disabled (404) unless OWNER_RECOVERY_SECRET is set as a Worker secret for this deployment. ' +
      'Intended only for a fully locked-out installation with no other recovery path available.',
    request: {
      body: { content: { 'application/json': { schema: requestSchema } } },
    },
    responses: {
      200: {
        description: 'Owner password reset — every existing session for that account was signed out.',
        content: { 'application/json': { schema: successSchema } },
      },
      403: {
        description: 'OWNER_RECOVERY_SECRET is set but the provided secret is wrong.',
        content: { 'application/json': { schema: errorSchema } },
      },
      404: {
        description: "OWNER_RECOVERY_SECRET isn't configured for this deployment, or no owner matches the email.",
        content: { 'application/json': { schema: errorSchema } },
      },
      429: {
        description: 'Rate limit exceeded for this client.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const configuredSecret = c.env.OWNER_RECOVERY_SECRET;
    if (!configuredSecret) {
      return c.json({ error: 'Not found' }, 404);
    }

    // Rate limited only once the feature is confirmed enabled — inlined rather than the shared
    // recoveryRateLimit middleware so the 404-when-unset check above always runs first.
    const rateLimitKey = c.req.header('CF-Connecting-IP') ?? 'local-dev';
    const { success } = await c.env.RECOVERY_RATE_LIMITER.limit({ key: rateLimitKey });
    if (!success) {
      return c.json({ error: 'Too many requests, please try again later' }, 429);
    }

    const { secret, email, newPassword } = c.req.valid('json');
    if (!constantTimeEqual(secret, configuredSecret)) {
      return c.json({ error: 'Incorrect secret' }, 403);
    }

    const db = getDb(c);
    const user = await getUserByEmail(db, email);
    if (!user || user.role !== 'owner') {
      return c.json({ error: 'No owner account found for that email' }, 404);
    }

    const credentialAccount = await getCredentialAccount(db, user.id);
    if (!credentialAccount) {
      return c.json({ error: 'No owner account found for that email' }, 404);
    }

    await updateAccountPassword(db, credentialAccount.id, await hashPassword(newPassword));
    await deleteAllSessionsForUser(db, user.id);
    await recordAudit(db, {
      actorLabel: 'owner-recovery-endpoint',
      action: 'owner.recovered',
      targetType: 'user',
      targetId: user.id,
    });

    return c.json({ message: 'Owner password reset. Sign in with the new password.' }, 200);
  },
);
