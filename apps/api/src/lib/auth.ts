import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { hasCmsAccess } from '@kenresoft-cms/contracts';
import { createDb } from '@kenresoft-cms/database';

import { recordAudit } from './audit';
import { authOptions } from './auth-options';
import { getEmailSender } from './email';
import type { Bindings } from './env';
import { getClientIp } from './client-ip';

// better-auth's own hardcoded fallback (confirmed against the installed 1.7.2 source,
// context/create-context.mjs) — it only refuses to start on this value when its own
// `isProduction` check (process.env.NODE_ENV === 'production') is true, which never holds in
// a Cloudflare Worker, so a deployment missing this secret runs silently, signing every
// session with a publicly known key, with no exception or log line anywhere. A real production
// incident (docs/ARCHITECTURE.md's Changelog, "real production reset" entries) — this check
// exists specifically so it can never recur unnoticed.
const BETTER_AUTH_DEFAULT_SECRET = 'better-auth-secret-12345678901234567890';

export function isAuthSecretConfigured(secret: string | undefined): boolean {
  return Boolean(secret) && secret !== BETTER_AUTH_DEFAULT_SECRET;
}

// `executionCtx` is optional and only needed by call sites whose request can trigger
// better-auth to send a verification email (apps/api/src/index.ts's auth catch-all,
// admin/users.ts's Add User) — everything else (session lookups, the admin password
// re-check) omits it and falls back to better-auth awaiting the send inline, which is fine
// for paths that never send mail. See docs/ARCHITECTURE.md's Changelog for why this exists.
//
// `options.staffOnboarding` marks an account being created on a CMS staff member's behalf (Add
// User): its role is granted right after sign-up, i.e. AFTER better-auth has already triggered the
// verification email, so the email can't tell from the (still 'none') role alone that it should
// point at the admin app rather than at a website.
export function createAuth(
  env: Bindings,
  executionCtx?: Pick<ExecutionContext, 'waitUntil'>,
  options: { staffOnboarding?: boolean } = {},
) {
  if (!isAuthSecretConfigured(env.BETTER_AUTH_SECRET)) {
    // Loud and unmissable (visible via `wrangler tail`, and every auth-touching request 500s)
    // rather than the silent, "worked fine, just insecurely" failure mode this replaces —
    // see the comment on BETTER_AUTH_DEFAULT_SECRET above for why better-auth's own guard
    // doesn't catch this on Workers.
    throw new Error(
      'BETTER_AUTH_SECRET is not set (or is still set to the unusable placeholder) for this ' +
        'deployment — refusing to start auth. Every session would otherwise be signed with a ' +
        "publicly known key. Run `wrangler secret put BETTER_AUTH_SECRET` (see docs/DEPLOYMENT.md) " +
        'with a real, randomly generated value, then retry.',
    );
  }

  const db = createDb(env.DB);

  function clientIp(headers: Headers | undefined): string {
    return getClientIp(headers, env);
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
    advanced: {
      ...authOptions.advanced,
      // The exact hook better-auth's own sign-up/sign-in/resend paths use internally
      // (runInBackgroundOrAwait, confirmed against the installed 1.7.2 source) to fire a
      // verification email without blocking the response on delivery. Without this, better-
      // auth still sends the email correctly — it just awaits it inline instead. Omitted
      // entirely (not set to `undefined`) when no executionCtx is available —
      // exactOptionalPropertyTypes rejects an explicit `undefined` for this field.
      ...(executionCtx ? { backgroundTasks: { handler: (promise: Promise<unknown>) => executionCtx.waitUntil(promise) } } : {}),
    },
    // Verification links always point at the Admin SPA's own /verify-email page (never at
    // this API's own baseURL-based redirect URL, which better-auth's default `url` field
    // would produce) — that page calls the verify endpoint itself and renders a real
    // success/failure UI, avoiding an ambiguous "redirect landed with no query param means
    // success" signal. Built from the same ADMIN_URL/CORS_ORIGINS fallback password-reset.ts
    // already uses for its own link — no new env var.
    emailVerification: {
      sendVerificationEmail: async ({ user, token, url }) => {
        const sender = getEmailSender(env);
        const role = (user as { role?: string }).role;
        if (!options.staffOnboarding && !hasCmsAccess(role)) {
          // A website user (e.g. a Commerce customer): better-auth's own verification URL, which
          // verifies the token and redirects to the `callbackURL` the site passed at sign-up
          // (validated against trustedOrigins above) — never the admin app, which a customer has
          // no business landing in.
          await sender.send({
            to: user.email,
            subject: 'Verify your email',
            text: `Verify your email address to finish setting up your account.

Verify here: ${url}

This link expires in 1 hour. If you didn't expect this, you can ignore this email.`,
            html: `<p>Verify your email address to finish setting up your account.</p><p><a href="${url}">Verify your email</a></p><p>This link expires in 1 hour. If you didn't expect this, you can ignore this email.</p>`,
          });
          return;
        }
        const verifyUrl = `${env.ADMIN_URL ?? env.CORS_ORIGINS.split(',')[0]}/verify-email?token=${token}`;
        await sender.send({
          to: user.email,
          subject: 'Verify your email — Kenresoft CMS',
          text: `Verify your email address to finish setting up your Kenresoft CMS account.\n\nVerify here: ${verifyUrl}\n\nThis link expires in 1 hour. You won't be able to sign in until you verify. If you didn't expect this, you can ignore this email.`,
          html: `<p>Verify your email address to finish setting up your Kenresoft CMS account.</p><p><a href="${verifyUrl}">Verify your email</a></p><p>This link expires in 1 hour. You won't be able to sign in until you verify.</p><p>If you didn't expect this, you can ignore this email.</p>`,
        });
      },
      sendOnSignUp: true,
      sendOnSignIn: true,
      expiresIn: 60 * 60,
    },
    // No databaseHooks.user.create.before granting "owner" to a bare first signup anymore —
    // that let an attacker who reaches a freshly-deployed, not-yet-set-up installation before
    // its real operator does simply sign up and claim ownership. The first owner is now created
    // only through the one-time bootstrap flow (routes/system/bootstrap-owner.ts,
    // docs/ARCHITECTURE.md §10) — every normal signup, first or not, gets the schema's own
    // 'editor' default and is promoted explicitly afterward (Add User / role changes).
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
          // requireEmailVerification means sign-up no longer creates a session inline
          // (ctx.context.newSession stays undefined) — the created user id has to come from
          // the endpoint's own returned response body instead, or this audit entry would
          // silently stop being recorded for every new signup.
          const newSession = ctx.context.newSession;
          const returned = ctx.context.returned as { user?: { id?: string } } | undefined;
          const newUserId = newSession?.user.id ?? returned?.user?.id;
          // For an already-registered email, better-auth deliberately returns a SYNTHETIC user
          // (random id, no row) so the response can't be used to enumerate accounts — auditing that
          // id would violate the audit_log -> user foreign key and 500 the whole sign-up, both
          // leaking the account's existence and breaking the enumeration-safe response. Only audit
          // a sign-up that actually created a row.
          const created = newUserId ? await db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, newUserId) }) : undefined;
          if (newUserId && created) {
            await recordAudit(db, {
              actorUserId: newUserId,
              action: 'auth.sign_up',
              targetType: 'user',
              targetId: newUserId,
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
