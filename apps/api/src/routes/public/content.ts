import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import { publicCacheControlHeader, publicCacheKey } from '../../lib/public-cache';
import { getContentTypeBySlug } from '../../repositories/content-types';
import { getPublishedEntryBySlug, listPublishedEntriesForContentType } from '../../repositories/entries';

export const publicContentRoute = new Hono<{ Bindings: Bindings }>();

// Edge-caches anonymous GETs on this router (§12) — a miss falls through to the handler,
// which returns a normal c.json() response; this only adds the Cache-Control header and
// stores a copy in the Cache API, it never changes what gets returned on a miss.
publicContentRoute.get('*', async (c, next) => {
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

publicContentRoute.get('/:contentType', async (c) => {
  const db = getDb(c);
  const contentType = await getContentTypeBySlug(db, c.req.param('contentType'));
  if (!contentType) {
    return c.json({ error: 'Content type not found' }, 404);
  }

  return c.json(await listPublishedEntriesForContentType(db, contentType.id));
});

publicContentRoute.get('/:contentType/:slug', async (c) => {
  const db = getDb(c);
  const contentType = await getContentTypeBySlug(db, c.req.param('contentType'));
  if (!contentType) {
    return c.json({ error: 'Content type not found' }, 404);
  }

  const entry = await getPublishedEntryBySlug(db, contentType.id, c.req.param('slug'));
  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  return c.json(entry);
});
