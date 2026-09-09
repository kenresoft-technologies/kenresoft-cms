import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Database, PluginCommerceCustomer } from '@kenresoft-cms/database';

import { getCustomerBySessionToken } from '../repository/customer-sessions';

const CUSTOMER_SESSION_COOKIE = 'commerce_customer_session';
const GUEST_CART_COOKIE = 'commerce_guest_cart';

// sameSite: 'none' mirrors apps/api/src/lib/auth-options.ts's own admin/API cookie reasoning —
// Commerce is frontend-agnostic, so a storefront is not guaranteed same-site with the API. CSRF
// protection for the routes that read these cookies comes from a combination of the existing
// global CORS allow-list (apps/api/src/middleware/cors.ts), requiring application/json bodies on
// most mutations (which forces a CORS preflight browsers won't let an untrusted origin pass), and
// an explicit per-request Origin check (../lib/origin-check.ts) applied to every mutating route on
// cart/customer/customer-auth — added specifically to close the gap CORS/preflight alone leaves
// open for a body-less mutation like POST /customer-auth/logout, a "simple" cross-origin request
// under the Fetch spec that a browser sends with no preflight at all. Not from SameSite itself —
// see docs/PLUGINS.md's Commerce section.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days, fixed at creation for both cookies.
};

export function setCustomerSessionCookie(c: Context, rawToken: string): void {
  setCookie(c, CUSTOMER_SESSION_COOKIE, rawToken, COOKIE_OPTS);
}

export function clearCustomerSessionCookie(c: Context): void {
  deleteCookie(c, CUSTOMER_SESSION_COOKIE, { path: '/' });
}

// The raw token itself (unhashed) — only ever used to delete the matching session row (logout),
// never trusted as identity directly. getCustomerFromRequest below is what routes needing an
// authenticated customer should call instead.
export function getCustomerSessionToken(c: Context): string | undefined {
  return getCookie(c, CUSTOMER_SESSION_COOKIE);
}

// A guest cart's id doubles as its own bearer capability — never accepted as identity for any
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

// Returns null for any missing/invalid/expired/disabled-customer session — callers that require
// a session 401 on null themselves; this helper never throws for that case.
export async function getCustomerFromRequest(c: Context, db: Database): Promise<PluginCommerceCustomer | null> {
  const token = getCookie(c, CUSTOMER_SESSION_COOKIE);
  if (!token) return null;
  return getCustomerBySessionToken(db, token);
}
