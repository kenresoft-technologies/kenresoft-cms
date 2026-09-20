import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp, requirePluginRole } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginVariables } from '@kenresoft-cms/plugin-sdk';
import type { PluginCommerceCustomerAddress } from '@kenresoft-cms/database';

import { listAddressesForCustomer } from '../repository/customer-addresses';
import type { CustomerRecord } from '../repository/customers';
import { getCustomerById, listCustomers, setCustomerDisabled } from '../repository/customers';

// CMS-staff-facing, session-gated like every other admin route — but gated at 'admin' rather
// than catalog's 'editor' floor: customer PII (email, address, phone) is closer to this
// codebase's own webhooks/Users-management sensitivity than day-to-day catalog editing
// (docs/PLUGINS.md's Commerce section). Customers are website users of the one shared identity
// system (role 'none'); these routes only ever see and touch those, never CMS staff accounts. A
// customer's password, sessions and email verification are Core's, not managed here.
export const adminCustomersRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginVariables }>();

const errorSchema = z.object({ error: z.string() });

const customerSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  emailVerified: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.string(),
});

function toCustomerSummary(row: CustomerRecord) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    emailVerified: row.emailVerified,
    disabled: row.disabled,
    createdAt: row.createdAt.toISOString(),
  };
}

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

adminCustomersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Commerce Admin: Customers'],
    summary: 'List customers, optionally filtered by a search term against email/name',
    middleware: requirePluginRole('admin'),
    request: { query: z.object({ search: z.string().optional() }) },
    responses: {
      200: { description: 'Matching customers.', content: { 'application/json': { schema: z.array(customerSummarySchema) } } },
    },
  }),
  async (c) => {
    const { search } = c.req.valid('query');
    const ctx = c.get('pluginContext');
    const rows = await listCustomers(ctx.db, search);
    return c.json(rows.map(toCustomerSummary), 200);
  },
);

const idParamSchema = z.object({ id: z.string().min(1) });

adminCustomersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Commerce Admin: Customers'],
    summary: 'Get a customer with their addresses',
    middleware: requirePluginRole('admin'),
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'The customer and their addresses.',
        content: { 'application/json': { schema: customerSummarySchema.extend({ addresses: z.array(addressSchema) }) } },
      },
      404: { description: 'No customer with that id.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const ctx = c.get('pluginContext');

    const customer = await getCustomerById(ctx.db, id);
    if (!customer) return c.json({ error: 'Customer not found' }, 404);

    const addresses = await listAddressesForCustomer(ctx.db, id);
    return c.json({ ...toCustomerSummary(customer), addresses: addresses.map(toAddress) }, 200);
  },
);

const disableSchema = z.object({ disabled: z.boolean() });

adminCustomersRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Commerce Admin: Customers'],
    summary: 'Disable or re-enable a customer account (disabling revokes every session)',
    middleware: requirePluginRole('admin'),
    request: { params: idParamSchema, body: { content: { 'application/json': { schema: disableSchema } } } },
    responses: {
      200: { description: 'The updated customer.', content: { 'application/json': { schema: customerSummarySchema } } },
      404: { description: 'No customer with that id.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { disabled } = c.req.valid('json');
    const ctx = c.get('pluginContext');

    const existing = await getCustomerById(ctx.db, id);
    if (!existing) return c.json({ error: 'Customer not found' }, 404);

    const updated = await setCustomerDisabled(ctx.db, id, disabled);

    return c.json(toCustomerSummary(updated!), 200);
  },
);

adminCustomersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/resend-verification-email',
    tags: ['Commerce Admin: Customers'],
    summary: "Resend the email-verification link on a customer's behalf",
    middleware: requirePluginRole('admin'),
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Sent (or a no-op if the customer is already verified).', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
      404: { description: 'No customer with that id.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const ctx = c.get('pluginContext');

    const customer = await getCustomerById(ctx.db, id);
    if (!customer) return c.json({ error: 'Customer not found' }, 404);

    if (customer.emailVerified) {
      return c.json({ message: "This customer's email is already verified, nothing sent." }, 200);
    }

    // Core's shared verification flow (better-auth), not a Commerce-specific token.
    await ctx.accounts.sendVerificationEmail({ email: customer.email });
    return c.json({ message: 'Verification email sent.' }, 200);
  },
);
