import { createRoute } from '@hono/zod-openapi';
import { pageListItemSchema, pageSchema } from '@kenresoft-cms/contracts';
import type { Page } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import { createOpenApiApp } from '../../lib/openapi';
import { publicCacheControlHeader, publicCacheKey } from '../../lib/public-cache';
import { getPublishedPageByRoute, listPublishedPages } from '../../repositories/pages';
import type { Page as DbPage } from '@kenresoft-cms/database';

export const publicPagesRoute = createOpenApiApp<{ Bindings: Bindings }>();

const notFoundSchema = z.object({ error: z.string() });
const byRouteQuerySchema = z.object({ route: z.string().min(1) });

function toPage(row: DbPage): Page {
  return {
    id: row.id,
    route: row.route,
    title: row.title,
    status: row.status as Page['status'],
    publishAt: row.publishAt ? row.publishAt.toISOString() : null,
    templateId: row.templateId,
    blocks: row.blocks.blocks,
    seo: row.seo ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Edge-caches anonymous GETs on this router (§8), keyed by path + query string so the two
// possible `?route=` values never collide with each other or with the unparameterized list
// route — same pattern routes/public/content.ts already uses, extended for a query param.
publicPagesRoute.get('*', async (c, next) => {
  const cache = caches.default;
  const url = new URL(c.req.url);
  const cacheKey = publicCacheKey(url.pathname + url.search);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  await next();

  if (c.res.ok) {
    c.res.headers.set('Cache-Control', publicCacheControlHeader());
    c.executionCtx.waitUntil(cache.put(cacheKey, c.res.clone()));
  }
});

publicPagesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Public pages'],
    summary: 'List every published page (id, route, title only)',
    description:
      'Deliberately narrow, like /public/route-patterns — id/route/title only, never the ' +
      'full block tree, for sitemap-style generation. Fetch one page fully via /by-route.',
    responses: {
      200: {
        description: 'Every published page.',
        content: { 'application/json': { schema: z.array(pageListItemSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const rows = await listPublishedPages(db);
    return c.json(
      rows.map((row) => ({ id: row.id, route: row.route, title: row.title })),
      200,
    );
  },
);

publicPagesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/by-route',
    tags: ['Public pages'],
    summary: 'Resolve a published page by its exact route',
    description:
      'A query param, not a path param — a route can contain slashes ("/services/design"), ' +
      "which Hono's router can't cleanly capture without a wildcard that would then compete " +
      "with the content-type catch-all's own wildcard (§4.2).",
    request: { query: byRouteQuerySchema },
    responses: {
      200: {
        description: 'The published page.',
        content: { 'application/json': { schema: pageSchema } },
      },
      404: {
        description:
          'No page at that route, or a draft page at that route — indistinguishable from the ' +
          'outside, same convention as a draft entry (§7).',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { route } = c.req.valid('query');
    const db = getDb(c);
    const page = await getPublishedPageByRoute(db, route);
    if (!page) {
      return c.json({ error: 'Page not found' }, 404);
    }
    return c.json(toPage(page), 200);
  },
);
