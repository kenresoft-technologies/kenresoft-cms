import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp, requirePluginRole } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginVariables } from '@kenresoft-cms/plugin-sdk';
import type { PluginCommerceOrder, PluginCommerceOrderItem, PluginCommerceOrderPayment } from '@kenresoft-cms/database';

import { getOrderById, listOrderItems, listOrders, updateOrderStatus } from '../repository/orders';
import { listPaymentAttemptsForOrder } from '../repository/payments';

// CMS-staff-facing order management — gated at 'editor', matching products/categories, not
// admin-customers.ts's stricter 'admin' floor: fulfilling orders (viewing what was bought, where
// it ships, moving it through pending -> paid -> fulfilled) is core day-to-day operational work
// for an editor, unlike browsing the full customer PII list.
export const adminOrdersRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginVariables }>();

const errorSchema = z.object({ error: z.string() });

const orderStatusSchema = z.enum(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']);

const addressSchema = z.object({
  recipientName: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  region: z.string().nullable(),
  postalCode: z.string(),
  country: z.string(),
  phone: z.string().nullable(),
});

const orderSummarySchema = z.object({
  id: z.string(),
  customerId: z.string().nullable(),
  customerEmail: z.string(),
  customerName: z.string(),
  status: orderStatusSchema,
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

const paymentAttemptSchema = z.object({
  id: z.string(),
  provider: z.literal('paystack'),
  reference: z.string(),
  status: z.enum(['pending', 'success', 'failed']),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});

const orderDetailSchema = orderSummarySchema.extend({
  shippingAddress: addressSchema,
  items: z.array(orderItemSchema),
  payments: z.array(paymentAttemptSchema),
});

function toOrderSummary(order: PluginCommerceOrder): z.infer<typeof orderSummarySchema> {
  return {
    id: order.id,
    customerId: order.customerId,
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    status: order.status,
    currency: order.currency,
    totalAmount: order.totalAmount,
    createdAt: order.createdAt.toISOString(),
  };
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

function toPaymentAttempt(payment: PluginCommerceOrderPayment): z.infer<typeof paymentAttemptSchema> {
  return {
    id: payment.id,
    provider: payment.provider,
    reference: payment.reference,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    createdAt: payment.createdAt.toISOString(),
    resolvedAt: payment.resolvedAt?.toISOString() ?? null,
  };
}

adminOrdersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Commerce Admin: Orders'],
    summary: 'List orders, newest first, optionally filtered by status',
    middleware: requirePluginRole('editor'),
    request: { query: z.object({ status: orderStatusSchema.optional() }) },
    responses: {
      200: { description: 'Matching orders.', content: { 'application/json': { schema: z.array(orderSummarySchema) } } },
    },
  }),
  async (c) => {
    const { status } = c.req.valid('query');
    const ctx = c.get('pluginContext');
    const orders = await listOrders(ctx.db, { status });
    return c.json(orders.map(toOrderSummary), 200);
  },
);

const idParamSchema = z.object({ id: z.string().min(1) });

adminOrdersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Commerce Admin: Orders'],
    summary: 'Get an order with its shipping address, line items, and payment attempts',
    middleware: requirePluginRole('editor'),
    request: { params: idParamSchema },
    responses: {
      200: { description: 'The order, its shipping address, its items, and its payment-attempt ledger.', content: { 'application/json': { schema: orderDetailSchema } } },
      404: { description: 'No order with that id.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const ctx = c.get('pluginContext');

    const order = await getOrderById(ctx.db, id);
    if (!order) return c.json({ error: 'Order not found' }, 404);

    const [items, payments] = await Promise.all([listOrderItems(ctx.db, id), listPaymentAttemptsForOrder(ctx.db, id)]);
    return c.json(
      { ...toOrderSummary(order), shippingAddress: order.shippingAddress, items: items.map(toOrderItem), payments: payments.map(toPaymentAttempt) },
      200,
    );
  },
);

const statusPatchSchema = z.object({ status: orderStatusSchema });

adminOrdersRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/status',
    tags: ['Commerce Admin: Orders'],
    summary: 'Transition an order’s status (cancelling/refunding restocks its tracked-variant lines)',
    middleware: requirePluginRole('editor'),
    request: { params: idParamSchema, body: { content: { 'application/json': { schema: statusPatchSchema } } } },
    responses: {
      200: { description: 'The updated order.', content: { 'application/json': { schema: orderSummarySchema } } },
      400: { description: 'That status transition is not valid from the order’s current status.', content: { 'application/json': { schema: errorSchema } } },
      404: { description: 'No order with that id.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');
    const ctx = c.get('pluginContext');

    const result = await updateOrderStatus(ctx.db, id, status);
    if (!result.ok) {
      if (result.error === 'not_found') return c.json({ error: 'Order not found' }, 404);
      return c.json({ error: `Cannot transition to '${status}' from the order's current status` }, 400);
    }

    return c.json(toOrderSummary(result.order), 200);
  },
);
