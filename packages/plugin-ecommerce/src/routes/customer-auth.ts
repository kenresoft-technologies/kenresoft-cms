import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicContext, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';
import type { Context } from 'hono';

import type { CommerceConfig } from '../config-schema';
import {
  getGuestCartId,
  clearGuestCartCookie,
  setCustomerSessionCookie,
  clearCustomerSessionCookie,
  getCustomerSessionToken,
} from '../lib/customer-session';
import { requireTrustedOriginForMutations } from '../lib/origin-check';
import { sendVerificationEmail } from '../lib/verification-email';
import { mergeGuestCartIntoCustomerCart } from '../repository/carts';
import { createCustomer, getCustomerByEmail, updateCustomerPassword, markCustomerEmailVerified, verifyCustomerPassword } from '../repository/customers';
import { createCustomerSession, deleteCustomerSession, deleteAllSessionsForCustomer } from '../repository/customer-sessions';
import { createCustomerToken, consumeCustomerToken } from '../repository/customer-tokens';

// The customer-facing register/login/logout/password-reset/verify-email surface — genuinely
// unauthenticated by definition (these ARE the auth endpoints). Mounted under
// PluginRegistration.publicRateLimits' 'customer-auth' rule (COMMERCE_CUSTOMER_AUTH_RATE_LIMITER,
// 10/60s per IP), on top of the generic public-content limiter every public route already gets.
export const customerAuthRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();

customerAuthRoutes.use('*', requireTrustedOriginForMutations());

const errorSchema = z.object({ error: z.string() });

const customerSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  emailVerified: z.boolean(),
});

function toCustomer(row: { id: string; email: string; name: string; phone: string | null; emailVerified: boolean }) {
  return { id: row.id, email: row.email, name: row.name, phone: row.phone, emailVerified: row.emailVerified };
}

async function mergeGuestCartIfPresent(c: Context, ctx: PluginPublicContext, customerId: string): Promise<void> {
  const guestCartId = getGuestCartId(c);
  if (!guestCartId) return;
  const config = (await ctx.config.get()) as CommerceConfig;
  await mergeGuestCartIntoCustomerCart(ctx.db, guestCartId, customerId, config.defaultCurrency);
  clearGuestCartCookie(c);
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
});

customerAuthRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/register',
    tags: ['Commerce Customer Auth'],
    summary: 'Register a new customer account',
    request: { body: { content: { 'application/json': { schema: registerSchema } } } },
    responses: {
      201: { description: 'The created customer, now signed in.', content: { 'application/json': { schema: customerSchema } } },
      409: {
        description: 'An account with that email already exists.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');

    if (await getCustomerByEmail(ctx.db, input.email)) {
      // Registration deliberately does distinguish "already registered" — a documented
      // usability-over-enumeration-resistance tradeoff at this one endpoint (docs/PLUGINS.md).
      return c.json({ error: 'An account with that email already exists' }, 409);
    }

    const customer = await createCustomer(ctx.db, {
      email: input.email,
      name: input.name,
      phone: input.phone ?? null,
      password: input.password,
    });

    const rawToken = await createCustomerSession(ctx.db, customer.id);
    setCustomerSessionCookie(c, rawToken);
    await mergeGuestCartIfPresent(c, ctx, customer.id);
    await sendVerificationEmail(ctx.db, c.executionCtx.waitUntil.bind(c.executionCtx), ctx.email, ctx.config, customer);

    return c.json(toCustomer(customer), 201);
  },
);

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

customerAuthRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/login',
    tags: ['Commerce Customer Auth'],
    summary: 'Sign in with email and password',
    request: { body: { content: { 'application/json': { schema: loginSchema } } } },
    responses: {
      200: { description: 'Signed in.', content: { 'application/json': { schema: customerSchema } } },
      401: {
        description: 'Invalid credentials — deliberately identical whether the email exists, the password is wrong, or the account is disabled.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');
    const invalid = () => c.json({ error: 'Invalid email or password' }, 401);

    const customer = await getCustomerByEmail(ctx.db, input.email);
    if (!customer || customer.disabled) return invalid();
    if (!(await verifyCustomerPassword(customer, input.password))) return invalid();

    const rawToken = await createCustomerSession(ctx.db, customer.id);
    setCustomerSessionCookie(c, rawToken);
    await mergeGuestCartIfPresent(c, ctx, customer.id);

    return c.json(toCustomer(customer), 200);
  },
);

customerAuthRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/logout',
    tags: ['Commerce Customer Auth'],
    summary: 'Sign out (idempotent)',
    responses: { 204: { description: 'Signed out, regardless of whether a session existed.' } },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const rawToken = getCustomerSessionToken(c);
    if (rawToken) await deleteCustomerSession(ctx.db, rawToken);
    clearCustomerSessionCookie(c);
    return c.body(null, 204);
  },
);

const requestResetSchema = z.object({ email: z.string().email() });
const genericMessageSchema = z.object({ message: z.string() });

customerAuthRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/password-reset/request',
    tags: ['Commerce Customer Auth'],
    summary: 'Request a password-reset email',
    request: { body: { content: { 'application/json': { schema: requestResetSchema } } } },
    responses: {
      200: {
        description: 'Always the identical generic response, regardless of whether the email matches an account.',
        content: { 'application/json': { schema: genericMessageSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');
    const genericResponse = { message: 'If that email is registered, a reset link has been sent.' };

    const customer = await getCustomerByEmail(ctx.db, input.email);
    if (customer && !customer.disabled) {
      const token = await createCustomerToken(ctx.db, customer.id, 'password_reset');
      const config = (await ctx.config.get()) as CommerceConfig;
      c.executionCtx.waitUntil(
        ctx.email.send({
          to: customer.email,
          subject: 'Reset your password',
          text: config.siteUrl
            ? `Reset your password by visiting: ${config.siteUrl}/account/reset-password?token=${token}`
            : `Reset your password with this token: ${token}`,
        }),
      );
    }

    return c.json(genericResponse, 200);
  },
);

const confirmResetSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8) });

customerAuthRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/password-reset/confirm',
    tags: ['Commerce Customer Auth'],
    summary: 'Complete a password reset with a token',
    request: { body: { content: { 'application/json': { schema: confirmResetSchema } } } },
    responses: {
      200: { description: 'Password reset; every existing session revoked.', content: { 'application/json': { schema: genericMessageSchema } } },
      400: { description: 'Invalid or expired token.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');

    const customerId = await consumeCustomerToken(ctx.db, input.token, 'password_reset');
    if (!customerId) return c.json({ error: 'Invalid or expired token' }, 400);

    await updateCustomerPassword(ctx.db, customerId, input.newPassword);
    await deleteAllSessionsForCustomer(ctx.db, customerId);

    return c.json({ message: 'Password reset successfully.' }, 200);
  },
);

customerAuthRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/verify-email',
    tags: ['Commerce Customer Auth'],
    summary: 'Confirm an email-verification token',
    request: { query: z.object({ token: z.string().min(1) }) },
    responses: {
      200: { description: 'Email verified.', content: { 'application/json': { schema: genericMessageSchema } } },
      400: { description: 'Invalid or expired token.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { token } = c.req.valid('query');
    const ctx = c.get('pluginContext');

    const customerId = await consumeCustomerToken(ctx.db, token, 'email_verification');
    if (!customerId) return c.json({ error: 'Invalid or expired token' }, 400);

    await markCustomerEmailVerified(ctx.db, customerId);
    return c.json({ message: 'Email verified.' }, 200);
  },
);

const resendVerificationSchema = z.object({ email: z.string().email() });

customerAuthRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/verify-email/resend',
    tags: ['Commerce Customer Auth'],
    summary: 'Resend the email-verification link',
    request: { body: { content: { 'application/json': { schema: resendVerificationSchema } } } },
    responses: {
      200: {
        description: 'Always the identical generic response, regardless of whether the email matches an account or is already verified.',
        content: { 'application/json': { schema: genericMessageSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');
    // Mirrors password-reset/request's own account-enumeration-resistant shape exactly — one
    // generic response regardless of which of "no such account" / "already verified" /
    // "disabled" / "sent" actually happened.
    const genericResponse = { message: 'If that email is registered and not yet verified, a new verification email has been sent.' };

    const customer = await getCustomerByEmail(ctx.db, input.email);
    if (customer && !customer.disabled && !customer.emailVerified) {
      await sendVerificationEmail(ctx.db, c.executionCtx.waitUntil.bind(c.executionCtx), ctx.email, ctx.config, customer);
    }

    return c.json(genericResponse, 200);
  },
);
