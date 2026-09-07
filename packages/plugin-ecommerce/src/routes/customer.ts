import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';
import type { Context } from 'hono';
import type { Database, PluginCommerceCustomer, PluginCommerceCustomerAddress } from '@kenresoft-cms/database';

import { getCustomerFromRequest, setCustomerSessionCookie } from '../lib/customer-session';
import {
  listAddressesForCustomer,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
} from '../repository/customer-addresses';
import { updateCustomer, updateCustomerPassword, verifyCustomerPassword } from '../repository/customers';
import { createCustomerSession, deleteAllSessionsForCustomer } from '../repository/customer-sessions';

// The session-required counterpart to customer-auth.ts — every route here 401s without a valid
// customer session (getCustomerFromRequest), reusing the same cookie customer-auth.ts sets.
export const customerRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();

// Registered before any .openapi() route below, so it runs before that route's own zod body
// validation — matching every session-gated Core/admin route's ordering (auth before validation,
// confirmed empirically: an unauthenticated POST with a malformed body against an existing
// requireSession-gated route 401s, it never leaks a 400 validation error first). Without this,
// @hono/zod-openapi's per-route body validation runs before a handler-body-only auth check ever
// gets a chance to, which would 400 an unauthenticated malformed-body request instead of 401ing
// it — a real ordering bug this project caught via its own commerce-customer-profile.test.ts.
customerRoutes.use('*', async (c, next) => {
  const ctx = c.get('pluginContext');
  const customer = await getCustomerFromRequest(c, ctx.db);
  if (!customer) {
    return c.json({ error: 'Not signed in' }, 401);
  }
  await next();
});

const errorSchema = z.object({ error: z.string() });

function requireCustomer(c: Context, db: Database) {
  return getCustomerFromRequest(c, db);
}

const customerSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  emailVerified: z.boolean(),
});

function toCustomer(row: PluginCommerceCustomer) {
  return { id: row.id, email: row.email, name: row.name, phone: row.phone, emailVerified: row.emailVerified };
}

customerRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Commerce Customer'],
    summary: 'Get the signed-in customer’s own profile',
    responses: {
      200: { description: 'The current customer.', content: { 'application/json': { schema: customerSchema } } },
      401: { description: 'No valid customer session.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const customer = await requireCustomer(c, ctx.db);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);
    return c.json(toCustomer(customer), 200);
  },
);

// Email is deliberately not updatable here — changing it would need its own re-verification
// flow, out of scope this pass; only name/phone can be edited.
const updateProfileSchema = z.object({ name: z.string().min(1).optional(), phone: z.string().nullable().optional() });

customerRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/',
    tags: ['Commerce Customer'],
    summary: 'Update name/phone',
    request: { body: { content: { 'application/json': { schema: updateProfileSchema } } } },
    responses: {
      200: { description: 'The updated customer.', content: { 'application/json': { schema: customerSchema } } },
      401: { description: 'No valid customer session.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const customer = await requireCustomer(c, ctx.db);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);

    const input = c.req.valid('json');
    const updated = await updateCustomer(ctx.db, customer.id, input);
    return c.json(toCustomer(updated!), 200);
  },
);

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });

customerRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/password',
    tags: ['Commerce Customer'],
    summary: 'Change password (revokes every other session)',
    request: { body: { content: { 'application/json': { schema: changePasswordSchema } } } },
    responses: {
      200: { description: 'Password changed; a fresh session cookie is set for this request.', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
      400: { description: 'Current password is incorrect.', content: { 'application/json': { schema: errorSchema } } },
      401: { description: 'No valid customer session.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const customer = await requireCustomer(c, ctx.db);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);

    const input = c.req.valid('json');
    if (!(await verifyCustomerPassword(customer, input.currentPassword))) {
      return c.json({ error: 'Current password is incorrect' }, 400);
    }

    await updateCustomerPassword(ctx.db, customer.id, input.newPassword);
    // Revoke every session (including the one making this request), then issue a fresh one for
    // this browser so the caller isn't logged out by their own password change while every other
    // device/session genuinely is.
    await deleteAllSessionsForCustomer(ctx.db, customer.id);
    const rawToken = await createCustomerSession(ctx.db, customer.id);
    setCustomerSessionCookie(c, rawToken);

    return c.json({ message: 'Password changed.' }, 200);
  },
);

const addressSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  recipientName: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  region: z.string().nullable(),
  postalCode: z.string(),
  country: z.string(),
  phone: z.string().nullable(),
  isDefault: z.boolean(),
});

function toAddress(row: PluginCommerceCustomerAddress) {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    country: row.country,
    phone: row.phone,
    isDefault: row.isDefault,
  };
}

const addressWritableSchema = z.object({
  label: z.string().nullable().optional(),
  recipientName: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().nullable().optional(),
  city: z.string().min(1),
  region: z.string().nullable().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(1),
  phone: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
});

customerRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/addresses',
    tags: ['Commerce Customer'],
    summary: 'List the signed-in customer’s addresses',
    responses: {
      200: { description: 'Every address.', content: { 'application/json': { schema: z.array(addressSchema) } } },
      401: { description: 'No valid customer session.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const customer = await requireCustomer(c, ctx.db);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);
    const addresses = await listAddressesForCustomer(ctx.db, customer.id);
    return c.json(addresses.map(toAddress), 200);
  },
);

customerRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/addresses',
    tags: ['Commerce Customer'],
    summary: 'Add an address',
    request: { body: { content: { 'application/json': { schema: addressWritableSchema } } } },
    responses: {
      201: { description: 'The created address.', content: { 'application/json': { schema: addressSchema } } },
      401: { description: 'No valid customer session.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const customer = await requireCustomer(c, ctx.db);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);

    const input = c.req.valid('json');
    const row = await createAddress(ctx.db, customer.id, {
      label: input.label ?? null,
      recipientName: input.recipientName,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      region: input.region ?? null,
      postalCode: input.postalCode,
      country: input.country,
      phone: input.phone ?? null,
      isDefault: input.isDefault ?? false,
    });
    return c.json(toAddress(row), 201);
  },
);

const addressIdParamSchema = z.object({ id: z.string().min(1) });
const addressPatchSchema = addressWritableSchema.partial();

customerRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/addresses/{id}',
    tags: ['Commerce Customer'],
    summary: 'Update an address',
    request: { params: addressIdParamSchema, body: { content: { 'application/json': { schema: addressPatchSchema } } } },
    responses: {
      200: { description: 'The updated address.', content: { 'application/json': { schema: addressSchema } } },
      401: { description: 'No valid customer session.', content: { 'application/json': { schema: errorSchema } } },
      404: { description: 'No address with that id belonging to this customer.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const customer = await requireCustomer(c, ctx.db);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);

    const { id } = c.req.valid('param');
    const existing = await getAddressById(ctx.db, id);
    if (!existing || existing.customerId !== customer.id) {
      return c.json({ error: 'Address not found' }, 404);
    }

    const row = await updateAddress(ctx.db, id, customer.id, c.req.valid('json'));
    return c.json(toAddress(row!), 200);
  },
);

customerRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/addresses/{id}',
    tags: ['Commerce Customer'],
    summary: 'Delete an address',
    request: { params: addressIdParamSchema },
    responses: {
      204: { description: 'The address was deleted.' },
      401: { description: 'No valid customer session.', content: { 'application/json': { schema: errorSchema } } },
      404: { description: 'No address with that id belonging to this customer.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const customer = await requireCustomer(c, ctx.db);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);

    const { id } = c.req.valid('param');
    const existing = await getAddressById(ctx.db, id);
    if (!existing || existing.customerId !== customer.id) {
      return c.json({ error: 'Address not found' }, 404);
    }

    await deleteAddress(ctx.db, id);
    return c.body(null, 204);
  },
);
