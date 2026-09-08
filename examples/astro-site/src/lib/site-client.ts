import { createKenresoftClient, type KenresoftClient } from '@kenresoft-cms/astro';

// Server-side (SSR) client factory. Astro renders every page on Cloudflare Workers at request
// time — the *browser's* cookies (guest-cart id, customer session) arrive on the incoming Astro
// request, but a fetch this Worker makes to the CMS API is a brand-new outbound request with no
// cookies of its own unless we forward them by hand. This is what makes real, server-verified
// protected-route checks possible (spec requirement: an actual auth check, not hidden UI) and
// lets SSR-rendered pages (header account/cart state, /account/*) reflect the real signed-in
// state on first render, with no client-side flash of the wrong state.
//
// Only used for GET requests that need to know "who is this" — never for the mutations
// (login/logout/add-to-cart/checkout/...), which run as real browser fetches from client-side
// script tags instead, so the browser's own cookie jar (and any Set-Cookie the API sends back)
// is handled by the browser itself with no proxying needed.
export function createServerClient(cookieHeader: string | null): KenresoftClient {
  return createKenresoftClient({
    url: import.meta.env.PUBLIC_KENRESOFT_CMS_URL,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (cookieHeader) headers.set('cookie', cookieHeader);
      return fetch(input, { ...init, headers });
    },
  });
}

export function getPublicApiUrl(): string {
  return import.meta.env.PUBLIC_KENRESOFT_CMS_URL;
}

// The real, server-verified protected-route check every /account/* page uses. Astro.redirect()
// only actually aborts rendering when returned directly from a page's own top-level frontmatter
// (not from a nested component — a child component "returning" a Response doesn't propagate up
// through the render tree), so this is a small helper each page calls itself, rather than a
// shared layout component that would silently fail to redirect. Verified live: hitting an
// /account/* page with no session cookie at all produces a real 30x, not a client-side-hidden
// page that briefly flashes real content.
export async function requireCustomerOrRedirect(
  request: Request,
  redirectTo: string,
): Promise<{ customer: import('@kenresoft-cms/astro').CommerceCustomer } | { redirect: string }> {
  const cms = createServerClient(request.headers.get('cookie'));
  const customer = await cms.commerce.customer.get().catch(() => null);
  if (!customer) {
    return { redirect: `/account/login?redirect=${encodeURIComponent(redirectTo)}` };
  }
  return { customer };
}
