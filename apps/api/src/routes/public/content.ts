import { createRoute } from '@hono/zod-openapi';
import { entrySchema } from '@kenresoft/contracts';
import type { Entry, EntryStatus } from '@kenresoft/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import { createOpenApiApp } from '../../lib/openapi';
import { publicCacheControlHeader, publicCacheKey } from '../../lib/public-cache';
import { getContentTypeBySlug } from '../../repositories/content-types';
import { getPublishedEntryBySlug, listPublishedEntriesForContentType } from '../../repositories/entries';
import type { Entry as DbEntry } from '@kenresoft/database';

export const publicContentRoute = createOpenApiApp<{ Bindings: Bindings }>();

const notFoundSchema = z.object({ error: z.string() });
const contentTypeParamSchema = z.object({ contentType: z.string().min(1) });
const entryParamSchema = z.object({ contentType: z.string().min(1), slug: z.string().min(1) });

function toEntry(row: DbEntry): Entry {
  return {
    id: row.id,
    contentTypeId: row.contentTypeId,
    slug: row.slug,
    status: row.status as EntryStatus,
    data: row.data,
    publishAt: row.publishAt ? row.publishAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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

publicContentRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{contentType}',
    tags: ['Public content'],
    summary: 'List published entries for a content type',
    request: { params: contentTypeParamSchema },
    responses: {
      200: {
        description: 'Every published entry for this content type.',
        content: { 'application/json': { schema: z.array(entrySchema) } },
      },
      404: {
        description: 'No content type with that slug.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { contentType: contentTypeSlug } = c.req.valid('param');
    const db = getDb(c);
    const contentType = await getContentTypeBySlug(db, contentTypeSlug);
    if (!contentType) {
      return c.json({ error: 'Content type not found' }, 404);
    }

    const entries = await listPublishedEntriesForContentType(db, contentType.id);
    return c.json(entries.map(toEntry), 200);
  },
);

publicContentRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{contentType}/{slug}',
    tags: ['Public content'],
    summary: 'Get a published entry by slug',
    request: { params: entryParamSchema },
    responses: {
      200: {
        description: 'The published entry.',
        content: { 'application/json': { schema: entrySchema } },
      },
      404: {
        description: 'No content type with that slug, or no published entry with that slug — indistinguishable from the outside, same as a draft entry.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { contentType: contentTypeSlug, slug } = c.req.valid('param');
    const db = getDb(c);
    const contentType = await getContentTypeBySlug(db, contentTypeSlug);
    if (!contentType) {
      return c.json({ error: 'Content type not found' }, 404);
    }

    const entry = await getPublishedEntryBySlug(db, contentType.id, slug);
    if (!entry) {
      return c.json({ error: 'Entry not found' }, 404);
    }

    return c.json(toEntry(entry), 200);
  },
);
