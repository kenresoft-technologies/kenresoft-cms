import { createRoute } from '@hono/zod-openapi';
import { structuredSettingsModuleSchema } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import { createOpenApiApp } from '../../lib/openapi';
import { publicCacheControlHeader, publicCacheKey } from '../../lib/public-cache';
import { getStructuredSettings } from '../../repositories/structured-settings';

export const publicStructuredSettingsRoute = createOpenApiApp<{ Bindings: Bindings }>();

const moduleParamSchema = z.object({ module: structuredSettingsModuleSchema });

// Edge-cached per module the same way public/global-variables.ts is (§12) — every module here
// is intentionally public (docs/ARCHITECTURE.md §6: Structured Settings holds site content, no
// module carries secrets), so nothing is filtered out before returning it.
publicStructuredSettingsRoute.get('*', async (c, next) => {
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

publicStructuredSettingsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{module}',
    tags: ['Public structured settings'],
    summary: 'One Structured Settings module',
    request: { params: moduleParamSchema },
    responses: {
      200: {
        description: "The module's data, or {} if it has never been saved.",
        content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
      },
    },
  }),
  async (c) => {
    const { module } = c.req.valid('param');
    const db = getDb(c);
    const row = await getStructuredSettings(db, module);
    return c.json(row?.data ?? {}, 200);
  },
);
