import { z } from '@hono/zod-openapi';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { publicCacheKey, publicMediaCacheControlHeader } from '../../lib/public-cache';
import { getMediaById } from '../../repositories/media';
import type { Bindings } from '../../lib/env';

export const publicMediaRoute = createOpenApiApp<{ Bindings: Bindings }>();

const notFoundSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });

// Same Cache API pattern as publicContentRoute (§12) — Worker-originated responses aren't
// cached by Cloudflare's CDN automatically, only via an explicit Cache API put/match.
publicMediaRoute.get('*', async (c, next) => {
  const cache = caches.default;
  const cacheKey = publicCacheKey(new URL(c.req.url).pathname);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  await next();

  if (c.res.ok) {
    c.res.headers.set('Cache-Control', publicMediaCacheControlHeader());
    c.executionCtx.waitUntil(cache.put(cacheKey, c.res.clone()));
  }
});

// Streams the raw image bytes — not a JSON response, so this stays a plain route (with a
// docs-only registerPath below), matching the admin equivalent
// (apps/api/src/routes/admin/media.ts) this mirrors. No auth, no draft/published distinction
// to hide: Media has no status concept (§14) — once uploaded, a file is addressable by anyone
// who has (or guesses) its id, the same trust model as any CDN-backed asset URL.
publicMediaRoute.get('/:id/file', async (c) => {
  const db = getDb(c);
  const row = await getMediaById(db, c.req.param('id'));
  if (!row) {
    return c.json({ error: 'Media not found' }, 404);
  }

  const object = await c.env.MEDIA_BUCKET.get(row.key);
  if (!object) {
    return c.json({ error: 'Media file missing from storage' }, 404);
  }

  return new Response(object.body, {
    headers: { 'Content-Type': row.contentType },
  });
});

publicMediaRoute.openAPIRegistry.registerPath({
  method: 'get',
  path: '/{id}/file',
  tags: ['Public media'],
  summary: 'Download a media file (public, unauthenticated)',
  request: { params: idParamSchema },
  responses: {
    200: {
      description: 'The raw file bytes.',
      content: { 'image/png': {}, 'image/jpeg': {}, 'image/gif': {}, 'image/webp': {} },
    },
    404: {
      description: 'No media with that id, or the file is missing from storage.',
      content: { 'application/json': { schema: notFoundSchema } },
    },
  },
});
