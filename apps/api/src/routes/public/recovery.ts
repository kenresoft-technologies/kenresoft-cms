import { createRoute } from '@hono/zod-openapi';
import { redeemRecoveryCodeSchema } from '@kenresoft/contracts';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { recoveryRateLimit } from '../../middleware/recovery-rate-limit';
import { getCredentialAccount, updateAccountPassword } from '../../repositories/accounts';
import { consumeRecoveryCode } from '../../repositories/recovery-codes';
import { deleteAllSessionsForUser } from '../../repositories/sessions';
import { getUserByEmail } from '../../repositories/users';
import type { Bindings } from '../../lib/env';

export const publicRecoveryRoute = createOpenApiApp<{ Bindings: Bindings }>();

publicRecoveryRoute.use('*', recoveryRateLimit);

const errorSchema = z.object({ error: z.string() });
const successSchema = z.object({ message: z.string() });

// The fallback recovery path for "forgot my password AND lost access to my email" — codes are
// generated ahead of time by the owner for their own account (apps/api/src/routes/admin/
// security.ts). A wrong email, a wrong/already-used code, and a disabled account all get the
// same generic error so this can't be used to enumerate accounts or probe which codes remain
// valid.
publicRecoveryRoute.openapi(
  createRoute({
    method: 'post',
    path: '/redeem',
    tags: ['Password recovery'],
    summary: 'Reset a password using a one-time recovery code',
    request: {
      body: { content: { 'application/json': { schema: redeemRecoveryCodeSchema } } },
    },
    responses: {
      200: {
        description: 'Password reset — every existing session for this user was signed out.',
        content: { 'application/json': { schema: successSchema } },
      },
      400: {
        description: 'Invalid email, code, or account state.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { email, code, newPassword } = c.req.valid('json');
    const db = getDb(c);

    const user = await getUserByEmail(db, email);
    const genericError = () => c.json({ error: 'Invalid email or recovery code' } as const, 400 as const);

    if (!user || user.disabled) {
      return genericError();
    }

    const consumed = await consumeRecoveryCode(db, user.id, code);
    if (!consumed) {
      return genericError();
    }

    const credentialAccount = await getCredentialAccount(db, user.id);
    if (!credentialAccount) {
      return genericError();
    }

    await updateAccountPassword(db, credentialAccount.id, await hashPassword(newPassword));
    await deleteAllSessionsForUser(db, user.id);
    await recordAudit(db, {
      actorLabel: 'recovery-code',
      action: 'password.reset',
      targetType: 'user',
      targetId: user.id,
    });

    return c.json({ message: 'Password reset. Sign in with your new password.' }, 200);
  },
);
