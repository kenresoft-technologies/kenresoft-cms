import type { PluginBindings } from '@kenresoft-cms/plugin-sdk';
import type { Context, MiddlewareHandler } from 'hono';

// Explicit, server-side CSRF defense for Commerce's cookie-authenticated public routes
// (cart/customer/customer-auth) — a second, independent layer on top of browser-enforced CORS,
// not a replacement for it. CORS alone leaves a real gap here: a state-changing request with no
// body/no custom headers (e.g. POST /customer-auth/logout) is a "simple" cross-origin request per
// the Fetch spec, meaning the browser sends it — and the cookie-bearing side effect fires — with
// no preflight and no server-side CORS check ever consulted; only the JSON *response* gets
// blocked from the attacker page's own JS, which doesn't undo the logout that already happened.
//
// A real cross-origin browser request (fetch, XHR, or a form submission), whether preflighted or
// not, always carries an Origin header naming the page that initiated it — this is intrinsic
// browser behavior, not something a page's own JS controls or can spoof. So: reject a mutating
// request whose Origin is present but NOT in Core's own CORS allow-list. A genuinely missing
// Origin (same-origin navigations in some older browsers, non-browser API clients, and this
// project's own vitest-pool-workers SELF.fetch test harness — which sends no Origin at all,
// mirroring the same asymmetry already documented for better-auth's own origin check on
// apps/api's auth routes) is passed through rather than rejected, since there's nothing to verify
// against a header that isn't there — GET/HEAD requests are exempt outright, since this defends
// against state changes, not reads.
export function requireTrustedOriginForMutations(): MiddlewareHandler<{ Bindings: PluginBindings }> {
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') {
      return next();
    }

    const origin = c.req.header('Origin');
    if (origin && !isAllowedOrigin(c, origin)) {
      return c.json({ error: 'Origin not allowed' }, 403);
    }

    return next();
  };
}

function isAllowedOrigin(c: Context<{ Bindings: PluginBindings }>, origin: string): boolean {
  const allowList = c.env.CORS_ORIGINS.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowList.includes(origin);
}
