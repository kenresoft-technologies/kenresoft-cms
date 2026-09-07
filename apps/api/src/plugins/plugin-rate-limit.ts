import type { MiddlewareHandler } from 'hono';

import type { Bindings } from '../lib/env';

// Generic application of a plugin-declared PluginPublicRateLimitRule (docs/PLUGINS.md) —
// apps/api/src/plugins/mount.ts calls this once per declared rule, passing only the binding
// name; nothing here knows which plugin or binding it's enforcing. Mirrors
// apps/api/src/middleware/auth-rate-limit.ts's exact posture (429 with the same body shape) for
// the one binding better-auth's own AUTH_RATE_LIMITER already established as correct.
export function createPluginRateLimitMiddleware(bindingName: string): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    const limiter = (c.env as unknown as Record<string, RateLimit | undefined>)[bindingName];

    if (!limiter) {
      // A plugin declared this rule but the deployment's wrangler.toml was never updated to add
      // the binding — an operator's forgotten deployment step shouldn't take down the whole
      // route entirely (fail closed), but the gap must stay loud, not silent.
      console.warn(`[plugin-rate-limit] Binding "${bindingName}" is not configured — request allowed unthrottled.`);
      return next();
    }

    const rateLimitKey = c.req.header('CF-Connecting-IP') ?? 'local-dev';
    const { success } = await limiter.limit({ key: rateLimitKey });
    if (!success) {
      return c.json({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' }, 429);
    }

    return next();
  };
}
