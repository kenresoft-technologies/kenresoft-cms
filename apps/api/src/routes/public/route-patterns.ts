import { createRoute } from '@hono/zod-openapi';
import { routePatternsListSchema } from '@kenresoft-cms/contracts';
import type { RoutePatternEntry } from '@kenresoft-cms/contracts';

import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import { createOpenApiApp } from '../../lib/openapi';
import { publicCacheControlHeader, publicCacheKey } from '../../lib/public-cache';
import { listContentTypesWithRoutePattern } from '../../repositories/content-types';

export const publicRoutePatternsRoute = createOpenApiApp<{ Bindings: Bindings }>();

// Edge-cached the same way global-variables.ts is (§12) — a single list response, no
// per-item sub-resource, invalidated on any content-type write that changes a routePattern
// (invalidatePublicRoutePatternsCache, called from routes/admin/content-types.ts).
publicRoutePatternsRoute.get('*', async (c, next) => {
  const cache = caches.default;
  const cacheKey = publicCacheKey(new URL(c.req.url).pathname);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  await next();

  if (c.res.ok) {
    c.res.headers.set('Cache-Control', publicCacheControlHeader());
    c.executionCtx.waitUntil(cache.put(cacheKey, c.res.clone()));
  }
});

publicRoutePatternsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Public route patterns'],
    summary: 'Every content type that has a frontend route pattern configured',
    description:
      'Deliberately narrow — {contentTypeSlug, routePattern} pairs only, never field ' +
      'definitions. Backs a frontend route resolver (e.g. @kenresoft-cms/astro\'s resolveRoute()) ' +
      'that needs to recognize which content type a URL belongs to without a developer ' +
      'hardcoding it. This is NOT the (deliberately unresolved) public content-type-metadata ' +
      'endpoint — see docs/ASTRO.md.',
    responses: {
      200: {
        description: 'Every content type with a non-null routePattern.',
        content: { 'application/json': { schema: routePatternsListSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const contentTypes = await listContentTypesWithRoutePattern(db);
    const entries: RoutePatternEntry[] = contentTypes
      .filter((contentType) => contentType.routePattern !== null)
      .map((contentType) => ({
        contentTypeSlug: contentType.slug,
        routePattern: contentType.routePattern!,
      }))
      .sort((a, b) => a.contentTypeSlug.localeCompare(b.contentTypeSlug));
    return c.json(entries, 200);
  },
);
