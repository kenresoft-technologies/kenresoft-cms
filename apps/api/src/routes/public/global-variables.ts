import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import { createOpenApiApp } from '../../lib/openapi';
import { publicCacheControlHeader, publicCacheKey } from '../../lib/public-cache';
import { listGlobalVariables } from '../../repositories/global-variables';

export const publicGlobalVariablesRoute = createOpenApiApp<{ Bindings: Bindings }>();

// Edge-cached the same way apps/api/src/routes/public/content.ts is (§12) — a single key
// (there's no per-variable sub-resource, unlike entries), invalidated on any admin write.
publicGlobalVariablesRoute.get('*', async (c, next) => {
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

publicGlobalVariablesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Public global variables'],
    summary: 'Every global variable as a flat key/value map',
    responses: {
      200: {
        description: 'Every global variable, keyed by name.',
        content: { 'application/json': { schema: z.record(z.string(), z.string()) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const variables = await listGlobalVariables(db);
    const map: Record<string, string> = {};
    for (const variable of variables) {
      map[variable.key] = variable.value;
    }
    return c.json(map, 200);
  },
);
