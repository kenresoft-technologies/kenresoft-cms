import { createRoute } from '@hono/zod-openapi';
import { confirmPasswordResetSchema, genericMessageSchema, requestPasswordResetSchema } from '@kenresoft/contracts';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { getEmailSender } from '../../lib/email';
import { createOpenApiApp } from '../../lib/openapi';
import { recoveryRateLimit } from '../../middleware/recovery-rate-limit';
import { getCredentialAccount, updateAccountPassword } from '../../repositories/accounts';
import { consumePasswordResetToken, createPasswordResetToken } from '../../repositories/password-reset';
import { deleteAllSessionsForUser } from '../../repositories/sessions';
import { getUserByEmail } from '../../repositories/users';
import type { Bindings } from '../../lib/env';

export const publicPasswordResetRoute = createOpenApiApp<{ Bindings: Bindings }>();

publicPasswordResetRoute.use('*', recoveryRateLimit);

const errorSchema = z.object({ error: z.string() });

const GENERIC_REQUEST_MESSAGE = {
  message: 'If an account exists for that email, a password reset link has been sent.',
};

// Always responds identically whether or not the email matches an account — an attacker
// probing emails against this endpoint learns nothing either way (docs/ARCHITECTURE.md's
// recovery section). Disabled accounts are treated the same as a non-existent email: their
// role/status isn't confirmable from here either.
publicPasswordResetRoute.openapi(
  createRoute({
    method: 'post',
    path: '/request',
    tags: ['Password recovery'],
    summary: 'Request a password-reset email',
    description: 'Always returns 200 with a generic message, regardless of whether the email matches an account.',
    request: {
      body: { content: { 'application/json': { schema: requestPasswordResetSchema } } },
    },
    responses: {
      200: {
        description: 'Generic acknowledgement — does not confirm whether the email exists.',
        content: { 'application/json': { schema: genericMessageSchema } },
      },
    },
  }),
  async (c) => {
    const { email } = c.req.valid('json');
    const db = getDb(c);
    const user = await getUserByEmail(db, email);

    if (user && !user.disabled) {
      const token = await createPasswordResetToken(db, user.id);
      const resetUrl = `${c.env.ADMIN_URL ?? c.env.CORS_ORIGINS.split(',')[0]}/reset-password?token=${token}`;
      const sender = getEmailSender(c.env);
      const send = sender.send({
        to: user.email,
        subject: 'Reset your Kenresoft CMS password',
        text: `Someone requested a password reset for your account. If this was you, reset your password here: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
        html: `<p>Someone requested a password reset for your account.</p><p>If this was you, <a href="${resetUrl}">reset your password here</a>. This link expires in 1 hour.</p><p>If you didn't request this, you can ignore this email.</p>`,
      });
      // Doesn't block the response on email delivery — a slow or failing provider shouldn't
      // change this route's response time or make the (deliberately generic) success response
      // conditional on send() succeeding, which would itself leak whether the email existed.
      c.executionCtx.waitUntil(send);
    }

    return c.json(GENERIC_REQUEST_MESSAGE, 200);
  },
);

publicPasswordResetRoute.openapi(
  createRoute({
    method: 'post',
    path: '/confirm',
    tags: ['Password recovery'],
    summary: 'Complete a password reset with a token from the reset email',
    request: {
      body: { content: { 'application/json': { schema: confirmPasswordResetSchema } } },
    },
    responses: {
      200: {
        description: 'Password reset — every existing session for this user was signed out.',
        content: { 'application/json': { schema: genericMessageSchema } },
      },
      400: {
        description: 'The token is invalid, already used, or expired.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { token, newPassword } = c.req.valid('json');
    const db = getDb(c);

    const userId = await consumePasswordResetToken(db, token);
    if (!userId) {
      return c.json({ error: 'This reset link is invalid or has expired' }, 400);
    }

    const credentialAccount = await getCredentialAccount(db, userId);
    if (!credentialAccount) {
      return c.json({ error: 'This reset link is invalid or has expired' }, 400);
    }

    await updateAccountPassword(db, credentialAccount.id, await hashPassword(newPassword));
    await deleteAllSessionsForUser(db, userId);
    await recordAudit(db, {
      actorLabel: 'password-reset',
      action: 'password.reset',
      targetType: 'user',
      targetId: userId,
    });

    return c.json({ message: 'Password reset. Sign in with your new password.' }, 200);
  },
);
