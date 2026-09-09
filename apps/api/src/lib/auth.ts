import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { createDb } from '@kenresoft-cms/database';

import { recordAudit } from './audit';
import { authOptions } from './auth-options';
import type { Bindings } from './env';

export function createAuth(env: Bindings) {
  const db = createDb(env.DB);

  function clientIp(headers: Headers | undefined): string {
    return headers?.get('CF-Connecting-IP') ?? 'local-dev';
  }

  return betterAuth({
    ...authOptions,
    database: drizzleAdapter(db, { provider: 'sqlite' }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Same allow-list the CORS middleware enforces (§9) — cross-origin cookie auth from the
    // admin SPA needs better-auth's own origin check to agree with it.
    trustedOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    databaseHooks: {
      user: {
        create: {
          // Bootstraps the very first signup as owner — every other admin (via the Add User
          // flow, §10) or owner (via ownership transfer) traces back to this one moment. Without
          // it, an owner could only ever be created by hand-editing the database.
          before: async () => {
            const existing = await db.query.user.findFirst({ columns: { id: true } });
            if (!existing) {
              return { data: { role: 'owner' } };
            }
          },
        },
      },
    },
    // Auth-event audit logging (docs/ARCHITECTURE.md §9's "record security-sensitive
    // administrative actions" extended to sign-in/up/out, not just role/ownership changes —
    // apps/api/src/lib/audit.ts is still the one place rows get written). `before`/`after` are
    // global request hooks, not scoped to one endpoint, so every handler here starts by
    // checking `ctx.path` and returning early for anything it doesn't care about.
    hooks: {
      // Sign-out needs a `before` hook specifically: better-auth's own /sign-out handler reads
      // the session cookie, deletes it, then returns — by the time an `after` hook could run,
      // the session row (and the user id it pointed to) is already gone. This reads the same
      // signed cookie the real handler does (confirmed against better-auth's own sign-out route
      // source), read-only, one step earlier.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-out') return;
        const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
        if (!token) return;
        const session = await ctx.context.internalAdapter.findSession(token).catch(() => null);
        if (session) {
          await recordAudit(db, {
            actorUserId: session.user.id,
            action: 'auth.sign_out',
            targetType: 'user',
            targetId: session.user.id,
            metadata: { ip: clientIp(ctx.headers) },
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email') {
          const newSession = ctx.context.newSession;
          if (newSession) {
            await recordAudit(db, {
              actorUserId: newSession.user.id,
              action: 'auth.sign_up',
              targetType: 'user',
              targetId: newSession.user.id,
              metadata: { ip: clientIp(ctx.headers) },
            });
          }
          return;
        }

        if (ctx.path === '/sign-in/email') {
          const newSession = ctx.context.newSession;
          if (newSession) {
            await recordAudit(db, {
              actorUserId: newSession.user.id,
              action: 'auth.sign_in',
              targetType: 'user',
              targetId: newSession.user.id,
              metadata: { ip: clientIp(ctx.headers) },
            });
            return;
          }

          const returned = ctx.context.returned;
          if (returned instanceof APIError) {
            const body = ctx.body as Record<string, unknown> | undefined;
            const email = typeof body?.email === 'string' ? body.email : 'unknown';
            await recordAudit(db, {
              actorLabel: email,
              action: 'auth.sign_in_failed',
              targetType: 'user',
              metadata: { ip: clientIp(ctx.headers), reason: returned.message },
            });
          }
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
