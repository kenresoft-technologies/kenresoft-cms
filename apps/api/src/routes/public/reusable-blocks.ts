import { createRoute, z } from '@hono/zod-openapi';
import { reusableBlockSchema } from '@kenresoft-cms/contracts';
import type { ReusableBlock } from '@kenresoft-cms/contracts';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { sanitizeReusableBlockConfig } from '../../lib/raw-html-guard';
import { publicCacheControlHeader, publicCacheKey } from '../../lib/public-cache';
import { getReusableBlockById } from '../../repositories/reusable-blocks';
import type { Bindings } from '../../lib/env';
import type { ReusableBlock as DbReusableBlock } from '@kenresoft-cms/database';

export const publicReusableBlocksRoute = createOpenApiApp<{ Bindings: Bindings }>();

const notFoundSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });

function toReusableBlock(row: DbReusableBlock): ReusableBlock {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ReusableBlock['type'],
    // Editor-authored HTML is re-sanitised on every public read (defense in depth).
    config: sanitizeReusableBlockConfig(row.type, row.config),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Phase 7 of the schema-driven frontend work (docs/SITE_BUILDER.md) — a `reusableBlockRef`
// block node only ever stores a `reusableBlockId`; rendering it needs the referenced block's
// own type/config, resolved live at render time (§3.4/§8's live-reference model — never
// copied), so a frontend needs a way to fetch one directly. Same no-auth trust model as media:
// once created, a reusable block is addressable by anyone who has its id.
publicReusableBlocksRoute.get('*', async (c, next) => {
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

publicReusableBlocksRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Public pages'],
    summary: 'Get a reusable block by id (public, unauthenticated)',
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'The reusable block.',
        content: { 'application/json': { schema: reusableBlockSchema } },
      },
      404: {
        description: 'No reusable block with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const block = await getReusableBlockById(db, c.req.valid('param').id);
    if (!block) return c.json({ error: 'Reusable block not found' }, 404);
    return c.json(toReusableBlock(block), 200);
  },
);
