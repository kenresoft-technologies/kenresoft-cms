import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';
import type { PluginCommerceCustomerAddress } from '@kenresoft-cms/database';

import { getCustomerFromRequest } from '../lib/customer-session';
import type { CommerceCustomer } from '../lib/customer-session';
import { requireTrustedOriginForMutations } from '../lib/origin-check';
import {
  listAddressesForCustomer,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
} from '../repository/customer-addresses';
import { getProfilePhone, updateOwnProfile } from '../repository/customers';
import { getOrderById, listOrderItems, listOrdersForCustomer } from '../repository/orders';
import type { PluginCommerceOrder, PluginCommerceOrderItem } from '@kenresoft-cms/database';

// The session-required customer surface — every route here 401s without a signed-in user. The
// session is Core's shared better-auth session (a customer signs up/in/out, verifies email and
// resets or changes their password through Core's /api/v1/auth/* and /api/v1/public/password-reset
// routes, not through Commerce). Commerce only owns the profile/addresses/orders behind it.
export const customerRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();

customerRoutes.use('*', requireTrustedOriginForMutations());

// Registered before any .openapi() route below, so it runs before that route's own zod body
// validation — matching every session-gated Core/admin route's ordering (auth before validation,
// confirmed empirically: an unauthenticated POST with a malformed body against an existing
// requireSession-gated route 401s, it never leaks a 400 validation error first). Without this,
// @hono/zod-openapi's per-route body validation runs before a handler-body-only auth check ever
// gets a chance to, which would 400 an unauthenticated malformed-body request instead of 401ing
// it — a real ordering bug this project caught via its own commerce-customer-profile.test.ts.
customerRoutes.use('*', async (c, next) => {
  const ctx = c.get('pluginContext');
  const customer = await getCustomerFromRequest(ctx);
  if (!customer) {
    return c.json({ error: 'Not signed in' }, 401);
  }
  await next();
});

const errorSchema = z.object({ error: z.string() });

function requireCustomer(ctx: Parameters<typeof getCustomerFromRequest>[0]) {
  return getCustomerFromRequest(ctx);
}

const customerSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  emailVerified: z.boolean(),
});

function toCustomer(row: CommerceCustomer, phone: string | null) {
  return { id: row.id, email: row.email, name: row.name, phone, emailVerified: row.emailVerified };
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
    const customer = await requireCustomer(ctx);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);
    return c.json(toCustomer(customer, await getProfilePhone(ctx.db, customer.id)), 200);
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
    const customer = await requireCustomer(ctx);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);

    const input = c.req.valid('json');
    await updateOwnProfile(ctx.db, customer.id, input);
    const refreshed = (await getCustomerFromRequest(ctx))!;
    return c.json(toCustomer({ ...refreshed, name: input.name ?? refreshed.name }, input.phone !== undefined ? input.phone : await getProfilePhone(ctx.db, customer.id)), 200);
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
    const customer = await requireCustomer(ctx);
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
    const customer = await requireCustomer(ctx);
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
    const customer = await requireCustomer(ctx);
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
    const customer = await requireCustomer(ctx);
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

const orderSummarySchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']),
  currency: z.string(),
  totalAmount: z.number(),
  createdAt: z.string(),
});

const orderItemSchema = z.object({
  id: z.string(),
  productId: z.string().nullable(),
  variantId: z.string().nullable(),
  productName: z.string(),
  variantName: z.string().nullable(),
  sku: z.string().nullable(),
  unitPriceAtPurchase: z.number(),
  quantity: z.number(),
});

const orderDetailSchema = orderSummarySchema.extend({ items: z.array(orderItemSchema) });

function toOrderSummary(order: PluginCommerceOrder): z.infer<typeof orderSummarySchema> {
  return { id: order.id, status: order.status, currency: order.currency, totalAmount: order.totalAmount, createdAt: order.createdAt.toISOString() };
}

function toOrderItem(item: PluginCommerceOrderItem): z.infer<typeof orderItemSchema> {
  return {
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    productName: item.productName,
    variantName: item.variantName,
    sku: item.sku,
    unitPriceAtPurchase: item.unitPriceAtPurchase,
    quantity: item.quantity,
  };
}

customerRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/orders',
    tags: ['Commerce Customer'],
    summary: 'List the signed-in customer’s own order history, newest first',
    responses: {
      200: { description: 'Every order placed by this customer.', content: { 'application/json': { schema: z.array(orderSummarySchema) } } },
      401: { description: 'No valid customer session.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const customer = await requireCustomer(ctx);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);
    const orders = await listOrdersForCustomer(ctx.db, customer.id);
    return c.json(orders.map(toOrderSummary), 200);
  },
);

const orderIdParamSchema = z.object({ id: z.string().min(1) });

customerRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/orders/{id}',
    tags: ['Commerce Customer'],
    summary: 'Get one of the signed-in customer’s own orders, with its line items',
    request: { params: orderIdParamSchema },
    responses: {
      200: { description: 'The order and its items.', content: { 'application/json': { schema: orderDetailSchema } } },
      401: { description: 'No valid customer session.', content: { 'application/json': { schema: errorSchema } } },
      404: { description: 'No order with that id belonging to this customer.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const customer = await requireCustomer(ctx);
    if (!customer) return c.json({ error: 'Not signed in' }, 401);

    const { id } = c.req.valid('param');
    const order = await getOrderById(ctx.db, id);
    // A guest order (customerId null) or another customer's order must 404 identically to a
    // nonexistent id — never distinguishable from the outside, matching this codebase's own
    // draft-vs-nonexistent-slug convention elsewhere.
    if (!order || order.customerId !== customer.id) {
      return c.json({ error: 'Order not found' }, 404);
    }

    const items = await listOrderItems(ctx.db, id);
    return c.json({ ...toOrderSummary(order), items: items.map(toOrderItem) }, 200);
  },
);
