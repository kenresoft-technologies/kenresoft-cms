import type { MiddlewareHandler } from 'hono';

import type { Bindings } from '../lib/env';

// The public content/media read routes (list-by-content-type, get-by-slug, media file/metadata)
// had no rate limiting at all, unlike forms/auth/recovery — a real gap: repeat requests for the
// *same* slug are cheap (edge-cached, apps/api/src/lib/public-cache.ts), but a flood of requests
// for varying/nonexistent slugs never hits that cache and reaches D1 on every request. Limit is
// deliberately much looser than the write-side limiters (form submissions, auth, recovery) —
// this guards against abuse/cost, not a security boundary, and real sites can have legitimately
// bursty read traffic (a popular page going viral, a frontend's build-time fetch of many slugs).
export const publicContentRateLimit: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const rateLimitKey = c.req.header('CF-Connecting-IP') ?? 'local-dev';
  const { success } = await c.env.PUBLIC_CONTENT_RATE_LIMITER.limit({ key: rateLimitKey });
  if (!success) {
    return c.json({ error: 'Too many requests, please try again later' }, 429);
  }

  return next();
};
