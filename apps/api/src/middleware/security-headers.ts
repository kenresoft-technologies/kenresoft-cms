import type { MiddlewareHandler } from 'hono';

// Required controls per docs/ARCHITECTURE.md §9 — applied to every response.
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
};
