import type { MiddlewareHandler } from 'hono';

const DEFAULT_CSP = "default-src 'none'; frame-ancestors 'none'";

// Scoped to exactly the Scalar API-reference page (§ packages/contracts +
// @hono/zod-openapi migration) — it loads its JS bundle from jsdelivr's CDN, its Inter/mono
// webfonts from fonts.scalar.com, and injects an inline bootstrap <script>, none of which the
// strict default policy above permits. Every other response keeps the strict default; this
// is not a global loosening. 'unsafe-inline' here is the same tradeoff Swagger UI's own
// official Docker image ships with — the page renders no user-supplied content, so it isn't a
// meaningful XSS vector. Deliberately does NOT allow connect-src to api.scalar.com — that's
// Scalar's hosted "curated registry" search, an external marketplace-discovery feature with
// no relevance to a self-hosted API's own reference doc.
const DOCS_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
  "style-src 'self' 'unsafe-inline'; " +
  "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.scalar.com; " +
  "img-src 'self' data: https:; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'";

// Required controls per docs/ARCHITECTURE.md §9 — applied to every response.
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.res.headers.set(
    'Content-Security-Policy',
    c.req.path === '/api/v1/docs' ? DOCS_CSP : DEFAULT_CSP,
  );
};
