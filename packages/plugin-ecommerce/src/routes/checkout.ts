import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicContext, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';
import type { Context } from 'hono';

import { resolveExistingCart } from '../lib/cart-resolution';
import { getCustomerFromRequest, clearGuestCartCookie } from '../lib/customer-session';
import { requireTrustedOriginForMutations } from '../lib/origin-check';
import { listItemsWithDetail } from '../repository/cart-items';
import { claimIdempotencyKey, completeIdempotencyKey } from '../repository/idempotency';
import { createOrder, listOrderItems } from '../repository/orders';
import type { PluginCommerceOrder, PluginCommerceOrderItem } from '@kenresoft-cms/database';

const IDEMPOTENCY_SCOPE = 'checkout';

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

type CheckoutInput = z.infer<typeof checkoutSchema>;
interface CheckoutOutcome {
  status: 201 | 400;
  body: z.infer<typeof orderSchema> | z.infer<typeof errorSchema>;
}

// The actual checkout logic, returning a (status, body) pair instead of calling c.json directly
// — the route handler below persists this exact pair against the request's Idempotency-Key
// before ever sending it, so a retried request (or a genuinely concurrent duplicate) replays the
// same outcome instead of re-running any of this, including a repeated out-of-stock/unavailable
// failure. A client that wants a real second attempt (e.g. after fixing their cart) must send a
// fresh Idempotency-Key — the same contract Stripe's own idempotency keys use.
async function performCheckout(
  c: Context<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>,
  ctx: PluginPublicContext,
  input: CheckoutInput,
  idempotencyKey: string,
): Promise<CheckoutOutcome> {
  const cart = await resolveExistingCart(c, ctx);
  const items = cart ? await listItemsWithDetail(ctx.db, cart.id) : [];
  if (!cart || items.length === 0) {
    return { status: 400, body: { error: 'Your cart is empty' } };
  }

  const customer = await getCustomerFromRequest(c, ctx.db);
  const email = input.email ?? customer?.email;
  const name = input.name ?? customer?.name;
  if (!email || !name) {
    return { status: 400, body: { error: 'An email and name are required to check out as a guest' } };
  }

  // Re-verified live at checkout time, not trusted from whenever each item was added to the
  // cart — a product/variant can be unpublished/archived at any point in between.
  const unavailable = items.filter(({ product, variant }) => product.status !== 'published' || (variant && variant.status !== 'active'));
  if (unavailable.length > 0) {
    return { status: 400, body: { error: `No longer available: ${unavailable.map(({ product }) => product.name).join(', ')}` } };
  }

  const result = await createOrder(ctx.db, {
    cartId: cart.id,
    customerId: customer?.id ?? null,
    customerEmail: email,
    customerName: name,
    currency: cart.currency,
    shippingAddress: input.shippingAddress,
    items,
    idempotencyKey,
  });

  if (!result.ok) {
    return { status: 400, body: { error: `Out of stock: ${result.unavailable.map((entry) => entry.productName).join(', ')}` } };
  }

  if (!customer) clearGuestCartCookie(c);

  const orderItems = await listOrderItems(ctx.db, result.order.id);
  return { status: 201, body: toOrderResponse(result.order, orderItems) };
}

checkoutRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Commerce Checkout'],
    summary: 'Convert the caller’s cart (guest or customer) into an order — requires an Idempotency-Key header',
    request: { body: { content: { 'application/json': { schema: checkoutSchema } } } },
    responses: {
      201: { description: 'The created order.', content: { 'application/json': { schema: orderSchema } } },
      400: {
        description:
          'An empty cart, a missing email/name for a guest checkout, an item no longer available, insufficient stock, or a missing Idempotency-Key header.',
        content: { 'application/json': { schema: errorSchema } },
      },
      409: {
        description: 'A request with this Idempotency-Key is already being processed — retry shortly.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return c.json({ error: 'A non-empty Idempotency-Key header (max 200 chars) is required' }, 400);
    }

    const claim = await claimIdempotencyKey(ctx.db, IDEMPOTENCY_SCOPE, idempotencyKey);
    if (claim.state === 'in_progress') {
      return c.json({ error: 'A request with this Idempotency-Key is already being processed' }, 409);
    }
    if (claim.state === 'completed') {
      // Each branch returns a literal status code (not the union `claim.status` itself) so
      // TypeScript can match it against the exact per-status response shape .openapi() declared
      // above — the cast is only ever narrowing to what completeIdempotencyKey actually stored
      // for that status, never widening to something unvalidated.
      if (claim.status === 201) return c.json(claim.body as z.infer<typeof orderSchema>, 201);
      if (claim.status === 409) return c.json(claim.body as z.infer<typeof errorSchema>, 409);
      return c.json(claim.body as z.infer<typeof errorSchema>, 400);
    }

    const input = c.req.valid('json');
    const outcome = await performCheckout(c, ctx, input, idempotencyKey);
    await completeIdempotencyKey(ctx.db, IDEMPOTENCY_SCOPE, idempotencyKey, outcome.status, outcome.body);
    if (outcome.status === 201) return c.json(outcome.body as z.infer<typeof orderSchema>, 201);
    return c.json(outcome.body as z.infer<typeof errorSchema>, 400);
  },
);
