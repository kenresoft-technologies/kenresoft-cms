import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';

import { resolveExistingCart } from '../lib/cart-resolution';
import { getCustomerFromRequest, clearGuestCartCookie } from '../lib/customer-session';
import { requireTrustedOriginForMutations } from '../lib/origin-check';
import { listItemsWithDetail } from '../repository/cart-items';
import { createOrder, listOrderItems } from '../repository/orders';
import type { PluginCommerceOrder, PluginCommerceOrderItem } from '@kenresoft-cms/database';

// Converts the caller's own cart (guest or customer) into a durable Order — the one place real,
// concurrency-safe stock enforcement happens (repository/orders.ts's createOrder); everywhere
// else (cart-items.ts, carts.ts) stock capping is advisory UX only. Guest checkout is supported
// deliberately, mirroring the guest-cart support Phase 2b already established — requiring an
// account to buy anything would be a real product regression, not a security necessity, since the
// order snapshots the buyer's email/name/address inline regardless of whether a customer row
// exists at all (docs/PLUGINS.md's Commerce section).
export const checkoutRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();

checkoutRoutes.use('*', requireTrustedOriginForMutations());

const errorSchema = z.object({ error: z.string() });

const shippingAddressSchema = z.object({
  recipientName: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().nullable().optional(),
  city: z.string().min(1),
  region: z.string().nullable().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(1),
  phone: z.string().nullable().optional(),
});

// email/name are optional here specifically because a signed-in customer's own profile supplies
// them by default (still overridable, e.g. shipping to someone else's named address) — required
// only when checking out as a guest, checked by hand in the handler below since that condition
// depends on session state a static zod schema can't see.
const checkoutSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  shippingAddress: shippingAddressSchema,
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

const orderSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']),
  currency: z.string(),
  totalAmount: z.number(),
  customerEmail: z.string(),
  customerName: z.string(),
  createdAt: z.string(),
  items: z.array(orderItemSchema),
});

function toOrderResponse(order: PluginCommerceOrder, items: PluginCommerceOrderItem[]): z.infer<typeof orderSchema> {
  return {
    id: order.id,
    status: order.status,
    currency: order.currency,
    totalAmount: order.totalAmount,
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    createdAt: order.createdAt.toISOString(),
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      unitPriceAtPurchase: item.unitPriceAtPurchase,
      quantity: item.quantity,
    })),
  };
}

checkoutRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Commerce Checkout'],
    summary: 'Convert the caller’s cart (guest or customer) into an order',
    request: { body: { content: { 'application/json': { schema: checkoutSchema } } } },
    responses: {
      201: { description: 'The created order.', content: { 'application/json': { schema: orderSchema } } },
      400: {
        description:
          'An empty cart, a missing email/name for a guest checkout, an item no longer available, or insufficient stock.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const input = c.req.valid('json');

    const cart = await resolveExistingCart(c, ctx);
    const items = cart ? await listItemsWithDetail(ctx.db, cart.id) : [];
    if (!cart || items.length === 0) {
      return c.json({ error: 'Your cart is empty' }, 400);
    }

    const customer = await getCustomerFromRequest(c, ctx.db);
    const email = input.email ?? customer?.email;
    const name = input.name ?? customer?.name;
    if (!email || !name) {
      return c.json({ error: 'An email and name are required to check out as a guest' }, 400);
    }

    // Re-verified live at checkout time, not trusted from whenever each item was added to the
    // cart — a product/variant can be unpublished/archived at any point in between.
    const unavailable = items.filter(({ product, variant }) => product.status !== 'published' || (variant && variant.status !== 'active'));
    if (unavailable.length > 0) {
      return c.json({ error: `No longer available: ${unavailable.map(({ product }) => product.name).join(', ')}` }, 400);
    }

    const result = await createOrder(ctx.db, {
      cartId: cart.id,
      customerId: customer?.id ?? null,
      customerEmail: email,
      customerName: name,
      currency: cart.currency,
      shippingAddress: input.shippingAddress,
      items,
    });

    if (!result.ok) {
      return c.json({ error: `Out of stock: ${result.unavailable.map((entry) => entry.productName).join(', ')}` }, 400);
    }

    if (!customer) clearGuestCartCookie(c);

    const orderItems = await listOrderItems(ctx.db, result.order.id);
    return c.json(toOrderResponse(result.order, orderItems), 201);
  },
);
