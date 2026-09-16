import type { MiddlewareHandler } from 'hono';

import type { Bindings } from '../lib/env';

// Server-side CSRF/Origin protection for cookie-authenticated Admin mutations. Admin auth uses
// `SameSite=None` cookies (Admin and API can be separate origins), which means a browser will
// still attach a valid session cookie to a cross-site request — SameSite alone provides no CSRF
// protection here. CORS itself only stops an attacker page's *script* from reading the
// response; a body-less "simple" cross-origin request (e.g. a bare `fetch(url, {method:
// 'POST'})` with no custom headers) is sent with no preflight and no server-side CORS check
// ever consulted, so the mutation's side effect still fires even though the JSON response would
// be blocked from the attacker's own JS. This closes that gap the same way
// packages/plugin-ecommerce/src/lib/origin-check.ts's `requireTrustedOriginForMutations`
// already does for Commerce's own cookie-authenticated public routes — mirrored here rather
// than imported, since that one is scoped to `PluginBindings`, not Core's `Bindings`.
//
// GET/HEAD are exempt (never mutate). A *present* Origin not in CORS_ORIGINS is rejected. A
// *missing* Origin is allowed through — non-browser clients (server-to-server calls, this
// project's own SELF.fetch test harness, and better-auth's own origin check on /api/v1/auth/*)
// never send one, and rejecting that case would break more than it protects.
export function requireTrustedOrigin(): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') {
      return next();
    }

    const origin = c.req.header('Origin');
    if (origin) {
      const allowList = c.env.CORS_ORIGINS.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (!allowList.includes(origin)) {
        return c.json({ error: 'Origin not allowed' }, 403);
      }
    }

    return next();
  };
}
