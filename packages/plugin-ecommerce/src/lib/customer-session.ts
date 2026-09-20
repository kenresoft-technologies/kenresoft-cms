import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { PluginPublicContext } from '@kenresoft-cms/plugin-sdk';

const GUEST_CART_COOKIE = 'commerce_guest_cart';

// Commerce has no session or login system of its own anymore: a signed-in customer is whoever the
// shared core (better-auth) session says they are, resolved by Core and handed over as
// PluginPublicContext.identity. Only the guest-cart bearer cookie is Commerce's own.
//
// sameSite: 'none' mirrors apps/api/src/lib/auth-options.ts's own cookie reasoning: Commerce is
// frontend-agnostic, so a storefront is not guaranteed same-site with the API. CSRF protection for
// the cookie-authenticated routes comes from the global CORS allow-list, requiring JSON bodies on
// most mutations, and the explicit per-request Origin check (./origin-check.ts), not SameSite.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days, fixed at creation.
};

// A guest cart's id doubles as its own bearer capability, never accepted as identity for any
// customer-scoped route (docs/PLUGINS.md's guest-cart-security note).
export function setGuestCartCookie(c: Context, cartId: string): void {
  setCookie(c, GUEST_CART_COOKIE, cartId, COOKIE_OPTS);
}

export function getGuestCartId(c: Context): string | undefined {
  return getCookie(c, GUEST_CART_COOKIE);
}

export function clearGuestCartCookie(c: Context): void {
  deleteCookie(c, GUEST_CART_COOKIE, { path: '/' });
}

export interface CommerceCustomer {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

// Null for no session / disabled account; callers that require a customer 401 on null
// themselves. Any signed-in account may shop, CMS staff included. Nothing here reads or trusts a
// role: the id comes from Core's server-side session lookup only.
export async function getCustomerFromRequest(ctx: Pick<PluginPublicContext, 'identity'>): Promise<CommerceCustomer | null> {
  const identity = await ctx.identity.getUser();
  if (!identity) return null;
  return { id: identity.id, email: identity.email, name: identity.name, emailVerified: identity.emailVerified };
}
