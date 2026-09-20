import type { PluginPublicContext } from '@kenresoft-cms/plugin-sdk';
import type { Context } from 'hono';
import type { PluginCommerceCart } from '@kenresoft-cms/database';

import type { CommerceConfig } from '../config-schema';
import { getGuestCartId, getCustomerFromRequest, clearGuestCartCookie } from './customer-session';
import { getCustomerCart, getGuestCart, mergeGuestCartIntoCustomerCart } from '../repository/carts';

// Shared by routes/cart.ts and routes/checkout.ts: resolves the caller's own cart (customer's or
// guest's) without creating anything. Extracted here specifically so checkout never has to
// duplicate cart.ts's own customer-vs-guest resolution logic.
//
// Sign-in now happens entirely in Core's auth routes (Commerce no longer has a login endpoint of
// its own to hook), so the guest-to-customer cart merge that used to run inside Commerce's login
// handler runs here instead: the first cart/checkout request made while signed in AND still
// carrying a guest-cart cookie merges that guest cart into the customer's cart (the same atomic,
// hijack-safe mergeGuestCartIntoCustomerCart) and clears the cookie.
export async function resolveExistingCart(c: Context, ctx: PluginPublicContext): Promise<PluginCommerceCart | null> {
  const customer = await getCustomerFromRequest(ctx);
  if (customer) {
    const guestCartId = getGuestCartId(c);
    if (guestCartId) {
      const config = (await ctx.config.get()) as CommerceConfig;
      await mergeGuestCartIntoCustomerCart(ctx.db, guestCartId, customer.id, config.defaultCurrency);
      clearGuestCartCookie(c);
    }
    const cart = await getCustomerCart(ctx.db, customer.id);
    return cart ?? null;
  }
  const guestCartId = getGuestCartId(c);
  if (!guestCartId) return null;
  const cart = await getGuestCart(ctx.db, guestCartId);
  return cart ?? null;
}
