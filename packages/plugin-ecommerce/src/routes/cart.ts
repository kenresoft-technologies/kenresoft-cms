import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicContext, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';
import type { PluginCommerceCart } from '@kenresoft-cms/database';

import type { CommerceConfig } from '../config-schema';
import { resolveExistingCart } from '../lib/cart-resolution';
import { getCustomerFromRequest, setGuestCartCookie, clearGuestCartCookie } from '../lib/customer-session';
import { requireTrustedOriginForMutations } from '../lib/origin-check';
import { createGuestCart, getOrCreateCartForCustomer, clearCart } from '../repository/carts';
import { listItemsWithDetail, addOrIncrementItem, updateItemQuantity, removeItem } from '../repository/cart-items';
import { getProductById } from '../repository/products';
import { getVariantById } from '../repository/variants';

// Works for either an authenticated customer (session cookie) or an anonymous guest (a separate
// cart-id-bearing cookie, never accepted as identity for any customer-scoped route — see
// docs/PLUGINS.md's guest-cart-security note). GET is side-effect-free by design: a cart is only
// ever created inside POST /items, the first add-to-cart call, not by reading an empty one.
export const cartRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();

cartRoutes.use('*', requireTrustedOriginForMutations());

const errorSchema = z.object({ error: z.string() });

const cartItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  variantId: z.string().nullable(),
  productName: z.string(),
  variantName: z.string().nullable(),
  quantity: z.number(),
  unitPrice: z.number(),
  currency: z.string(),
  stockQty: z.number().nullable(),
});

const cartSchema = z.object({
  id: z.string().nullable(),
  currency: z.string().nullable(),
  items: z.array(cartItemSchema),
});

const emptyCart = { id: null, currency: null, items: [] };

async function serializeCart(ctx: PluginPublicContext, cart: PluginCommerceCart | null) {
  if (!cart) return emptyCart;
  const items = await listItemsWithDetail(ctx.db, cart.id);
  return {
    id: cart.id,
    currency: cart.currency,
    items: items.map(({ item, product, variant }) => ({
      id: item.id,
      productId: product.id,
      variantId: variant?.id ?? null,
      productName: product.name,
      variantName: variant?.name ?? null,
      quantity: item.quantity,
      unitPrice: variant?.price ?? product.basePrice,
      currency: product.currency,
      stockQty: variant?.stockQty ?? null,
    })),
  };
}

cartRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Commerce Cart'],
    summary: 'Get the caller’s cart (guest cookie or customer session) — creates nothing',
    responses: {
      200: { description: 'The current cart, or an empty shape if none exists yet.', content: { 'application/json': { schema: cartSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const cart = await resolveExistingCart(c, ctx);
    return c.json(await serializeCart(ctx, cart), 200);
  },
);

const addItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  quantity: z.number().int().min(1).default(1),
});

cartRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/items',
    tags: ['Commerce Cart'],
    summary: 'Add an item — creates the cart on first use if none exists yet',
    request: { body: { content: { 'application/json': { schema: addItemSchema } } } },
    responses: {
      200: { description: 'The updated cart.', content: { 'application/json': { schema: cartSchema } } },
      400: {
        description:
          'Unknown product/variant, an unpublished product, an archived or out-of-stock variant, or a currency that does not match the cart’s existing currency.',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const input = c.req.valid('json');

    const product = await getProductById(ctx.db, input.productId);
    if (!product || product.status !== 'published') {
      return c.json({ error: 'No published product with that id' }, 400);
    }
    if (input.variantId) {
      const variant = await getVariantById(ctx.db, input.variantId);
      if (!variant || variant.productId !== product.id) {
        return c.json({ error: 'No variant with that id belonging to that product' }, 400);
      }
      if (variant.status !== 'active') {
        return c.json({ error: 'This variant is no longer available' }, 400);
      }
    }

    let cart = await resolveExistingCart(c, ctx);

    if (!cart) {
      const config = (await ctx.config.get()) as CommerceConfig;
      const customer = await getCustomerFromRequest(c, ctx.db);
      if (customer) {
        cart = await getOrCreateCartForCustomer(ctx.db, customer.id, config.defaultCurrency);
      } else {
        cart = await createGuestCart(ctx.db, config.defaultCurrency);
        setGuestCartCookie(c, cart.id);
      }
    }

    if (product.currency !== cart.currency) {
      return c.json({ error: `This product is priced in ${product.currency}, but the cart is in ${cart.currency}` }, 400);
    }

    const added = await addOrIncrementItem(ctx.db, cart.id, {
      productId: input.productId,
      variantId: input.variantId ?? null,
      quantity: input.quantity,
    });
    if (added === null) {
      return c.json({ error: 'This variant is out of stock' }, 400);
    }

    return c.json(await serializeCart(ctx, cart), 200);
  },
);

const itemIdParamSchema = z.object({ itemId: z.string().min(1) });
const updateQuantitySchema = z.object({ quantity: z.number().int().min(1) });

cartRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/items/{itemId}',
    tags: ['Commerce Cart'],
    summary: 'Update an item’s quantity',
    request: { params: itemIdParamSchema, body: { content: { 'application/json': { schema: updateQuantitySchema } } } },
    responses: {
      200: { description: 'The updated cart.', content: { 'application/json': { schema: cartSchema } } },
      404: { description: 'No such item in the caller’s own cart.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const cart = await resolveExistingCart(c, ctx);
    const { itemId } = c.req.valid('param');

    if (!cart || !(await belongsToCart(ctx, cart.id, itemId))) {
      return c.json({ error: 'Item not found' }, 404);
    }

    await updateItemQuantity(ctx.db, itemId, c.req.valid('json').quantity);
    return c.json(await serializeCart(ctx, cart), 200);
  },
);

cartRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/items/{itemId}',
    tags: ['Commerce Cart'],
    summary: 'Remove an item',
    request: { params: itemIdParamSchema },
    responses: {
      200: { description: 'The updated cart.', content: { 'application/json': { schema: cartSchema } } },
      404: { description: 'No such item in the caller’s own cart.', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const cart = await resolveExistingCart(c, ctx);
    const { itemId } = c.req.valid('param');

    if (!cart || !(await belongsToCart(ctx, cart.id, itemId))) {
      return c.json({ error: 'Item not found' }, 404);
    }

    await removeItem(ctx.db, itemId);
    return c.json(await serializeCart(ctx, cart), 200);
  },
);

cartRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/',
    tags: ['Commerce Cart'],
    summary: 'Clear the whole cart',
    responses: { 204: { description: 'Cleared (or already empty/nonexistent).' } },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const cart = await resolveExistingCart(c, ctx);
    if (cart) {
      await clearCart(ctx.db, cart.id);
      if (!cart.customerId) clearGuestCartCookie(c);
    }
    return c.body(null, 204);
  },
);

async function belongsToCart(ctx: PluginPublicContext, cartId: string, itemId: string): Promise<boolean> {
  const items = await listItemsWithDetail(ctx.db, cartId);
  return items.some(({ item }) => item.id === itemId);
}
