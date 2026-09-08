import type { PluginPublicContext } from '@kenresoft-cms/plugin-sdk';
import type { Context } from 'hono';
import type { PluginCommerceCart } from '@kenresoft-cms/database';

import { getGuestCartId, getCustomerFromRequest } from './customer-session';
import { getCustomerCart, getGuestCart } from '../repository/carts';

// Shared by routes/cart.ts and routes/checkout.ts — resolves the caller's own cart (customer's or
// guest's) without creating anything. Extracted here specifically so checkout never has to
// duplicate cart.ts's own customer-vs-guest resolution logic.
export async function resolveExistingCart(c: Context, ctx: PluginPublicContext): Promise<PluginCommerceCart | null> {
  const customer = await getCustomerFromRequest(c, ctx.db);
  if (customer) {
    const cart = await getCustomerCart(ctx.db, customer.id);
    return cart ?? null;
  }
  const guestCartId = getGuestCartId(c);
  if (!guestCartId) return null;
  const cart = await getGuestCart(ctx.db, guestCartId);
  return cart ?? null;
}
