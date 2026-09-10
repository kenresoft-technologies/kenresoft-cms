import { createRoute } from '@hono/zod-openapi';
import { structuredSettingsModuleSchema } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import { createOpenApiApp } from '../../lib/openapi';
import { getStructuredSettings } from '../../repositories/structured-settings';

export const publicStructuredSettingsRoute = createOpenApiApp<{ Bindings: Bindings }>();

const moduleParamSchema = z.object({ module: structuredSettingsModuleSchema });

// Deliberately NOT edge-cached, unlike public/global-variables.ts and the content/media routes
// (§12) — the Workers Cache API (caches.default) is per-data-center, so cache.delete() on save
// only clears the one colo that handled the write, leaving every other colo serving a stale
// copy for up to its own TTL. That's an acceptable trade for high-traffic content, but this
// route is read once per website page render (low volume) and every module here is admin-
// edited config an editor expects to see reflected everywhere immediately after saving — so
// this always reads straight from D1 instead of risking the cross-colo staleness window.
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
