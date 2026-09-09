import { getBrowserClient } from './browser-client';
import type { CommerceCustomer } from '@kenresoft-cms/astro';

// SSR (site-client.ts's createServerClient) can't reliably answer "is this visitor signed in"
// for Commerce on a cross-origin deployment — the customer session cookie is set directly by the
// browser's own fetch to the CMS API (browser-client.ts), which lands under the API's own origin,
// never the Astro site's. The incoming request Astro's SSR sees only carries cookies that already
// belong to the Astro site's own origin, so forwarding "the request's cookie header" to the CMS
// API (as createServerClient does) reliably sees no cookie at all and misreports every genuinely
// signed-in visitor as a guest — this is what made /account/* permanently bounce back to /login
// even right after a successful sign-in, on any deployment where the site and API aren't the same
// origin (the common case, including local dev against a live/remote API). This helper is the
// real check: a direct client-side fetch using the browser's own cookie jar, which — the whole
// reason any of this works — DOES correctly attach the API-origin cookie to a request TO that
// same origin even though the page itself is on a different one (browser-client.ts's
// `credentials: 'include'`).
export async function getCustomerClientSide(): Promise<CommerceCustomer | null> {
  try {
    return await getBrowserClient().commerce.customer.get();
  } catch {
    return null;
  }
}

// For a page whose real content must never render for a signed-out visitor. Redirects to
// /account/login (preserving redirectTo) and resolves null when unauthenticated; otherwise
// resolves the signed-in customer.
export async function requireCustomerClientSide(redirectTo: string): Promise<CommerceCustomer | null> {
  const customer = await getCustomerClientSide();
  if (!customer) {
    window.location.href = `/account/login?redirect=${encodeURIComponent(redirectTo)}`;
    return null;
  }
  return customer;
}
