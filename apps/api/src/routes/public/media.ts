import { createRoute, z } from '@hono/zod-openapi';
import { publicMediaSchema } from '@kenresoft/contracts';
import type { PublicMedia } from '@kenresoft/contracts';

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

// The subset of Media metadata that's safe to expose publicly (docs on publicMediaSchema) —
// closes a real gap for external consumers of the file route below: without this, there's no
// way to set an <img alt> or reserve layout space while the image loads (@kenresoft/astro and
// examples/astro-site currently fall back to the entry's title as alt text for exactly this
// reason — docs/ASTRO.md's Known limitations). Same no-auth trust model as the file route: once
// uploaded, a file (and now its renderable metadata) is addressable by anyone who has its id.
publicMediaRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Public media'],
    summary: 'Get a media file\'s public metadata (public, unauthenticated)',
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Alt text, content type, and dimensions for rendering this file.',
        content: { 'application/json': { schema: publicMediaSchema } },
      },
      404: {
        description: 'No media with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const row = await getMediaById(db, c.req.valid('param').id);
    if (!row) {
      return c.json({ error: 'Media not found' }, 404);
    }

    const response: PublicMedia = {
      altText: row.altText,
      contentType: row.contentType,
      width: row.width,
      height: row.height,
    };
    return c.json(response, 200);
  },
);

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

  // Buffered rather than passed through as object.body's ReadableStream: the cache
  // middleware above calls c.res.clone() on every ok response, and cloning a
  // stream-backed Response means teeing that stream — uploads are capped at 10MB
  // (apps/api/src/routes/admin/media.ts's MAX_UPLOAD_BYTES), so buffering costs nothing
  // real and sidesteps relying on stream-teeing behavior entirely.
  const bytes = await object.arrayBuffer();

  return new Response(bytes, {
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
