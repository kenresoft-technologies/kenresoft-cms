import { createRoute, z } from '@hono/zod-openapi';
import { publicUiContentItemSchema } from '@kenresoft-cms/contracts';
import type { PublicUiContentItem } from '@kenresoft-cms/contracts';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { publicCacheControlHeader, publicCacheKey } from '../../lib/public-cache';
import { getEnabledUiContentItemBySlug, getUiContentTypeBySlug, listEnabledUiContentItems } from '../../repositories/ui-content';
import type { Bindings } from '../../lib/env';

export const publicUiContentRoute = createOpenApiApp<{ Bindings: Bindings }>();

const notFoundSchema = z.object({ error: z.string() });

// Same Cache API pattern as publicContentRoute (§12).
publicUiContentRoute.get('*', async (c, next) => {
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

function toPublic(row: { slug: string; data: Record<string, unknown>; updatedAt: Date }): PublicUiContentItem {
  return { slug: row.slug, data: row.data, updatedAt: row.updatedAt.toISOString() };
}

publicUiContentRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{type}',
    tags: ['Public UI content'],
    summary: 'List every enabled item of a UI content type (public, unauthenticated)',
    request: { params: z.object({ type: z.string().min(1) }) },
    responses: {
      200: {
        description: "Every enabled item, whether the type exists or not — an unknown type slug returns an empty array.",
        content: { 'application/json': { schema: z.array(publicUiContentItemSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const type = await getUiContentTypeBySlug(db, c.req.valid('param').type);
    if (!type) return c.json([], 200);
    const items = await listEnabledUiContentItems(db, type.id);
    return c.json(items.map(toPublic), 200);
  },
);

// A disabled item 404s exactly like a nonexistent slug — never distinguishable from the
// outside, the same convention Entries' draft/published split already established.
publicUiContentRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{type}/{slug}',
    tags: ['Public UI content'],
    summary: 'Get a single enabled UI content item by slug (public, unauthenticated)',
    request: { params: z.object({ type: z.string().min(1), slug: z.string().min(1) }) },
    responses: {
      200: { description: 'The item.', content: { 'application/json': { schema: publicUiContentItemSchema } } },
      404: {
        description: 'No type/item with that slug, or the item is disabled.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const { type: typeSlug, slug } = c.req.valid('param');
    const type = await getUiContentTypeBySlug(db, typeSlug);
    if (!type) return c.json({ error: 'Not found' }, 404);
    const item = await getEnabledUiContentItemBySlug(db, type.id, slug);
    if (!item) return c.json({ error: 'Not found' }, 404);
    return c.json(toPublic(item), 200);
  },
);
