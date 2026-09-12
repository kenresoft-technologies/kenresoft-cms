import { createRoute } from '@hono/zod-openapi';
import {
  createReusableBlockSchema,
  idParamSchema,
  reusableBlockSchema,
  updateReusableBlockSchema,
} from '@kenresoft-cms/contracts';
import type { ReusableBlock } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { enqueueCachePurgePaths, processCachePurgeJobBatch } from '../../lib/cache-purge';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import { listPages } from '../../repositories/pages';
import {
  createReusableBlock,
  deleteReusableBlock,
  getReusableBlockById,
  listReusableBlocks,
  updateReusableBlock,
} from '../../repositories/reusable-blocks';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { Database, ReusableBlock as DbReusableBlock } from '@kenresoft-cms/database';

export const reusableBlocksRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });

const requireReusableBlockWriteRole = requireRole('admin', 'editor');

function toReusableBlock(row: DbReusableBlock): ReusableBlock {
  return {
    id: row.id,
    name: row.name,
    // The DB column is typed as the full BlockType union, but every write path validates
    // against the narrower reusableBlockTypeSchema before it ever reaches this table.
    type: row.type as ReusableBlock['type'],
    config: row.config,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// A reusable block is a *live* reference (§3.4/§8) — editing or deleting one can change what
// any number of pages actually render, and this route has no cheap way to know which pages
// embed it (that's exactly the tradeoff §3.4 accepts). Conservatively purges every page's own
// cache entry plus the list cache, queued through the existing cache_purge_jobs mechanism the
// same way a bulk import or the scheduled auto-publish sweep already does, rather than
// building an unproven per-page usage tracker.
async function invalidateAllPageCaches(db: Database): Promise<void> {
  const allPages = await listPages(db);
  const paths = new Set<string>(['/api/v1/public/pages']);
  for (const page of allPages) {
    paths.add(`/api/v1/public/pages/by-route?route=${encodeURIComponent(page.route)}`);
  }
  const job = await enqueueCachePurgePaths(db, Array.from(paths));
  // Awaited directly (not itself handed to ctx.waitUntil) — this whole function already runs
  // inside the caller's own ctx.waitUntil(...), and a second, nested waitUntil registration
  // isn't guaranteed to be drained before the outer one is considered settled.
  await processCachePurgeJobBatch(db, job);
}

reusableBlocksRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Reusable blocks'],
    summary: 'List every reusable block',
    responses: {
      200: {
        description: 'Every reusable block.',
        content: { 'application/json': { schema: z.array(reusableBlockSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    return c.json((await listReusableBlocks(db)).map(toReusableBlock), 200);
  },
);

reusableBlocksRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Reusable blocks'],
    summary: 'Create a reusable block',
    middleware: requireReusableBlockWriteRole,
    request: { body: { content: { 'application/json': { schema: createReusableBlockSchema } } } },
    responses: {
      201: {
        description: 'The created reusable block.',
        content: { 'application/json': { schema: reusableBlockSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);
    const block = await createReusableBlock(db, input);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'reusable_block.created',
      targetType: 'reusable_block',
      targetId: block.id,
      metadata: { name: block.name, type: block.type },
    });
    return c.json(toReusableBlock(block), 201);
  },
);

reusableBlocksRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Reusable blocks'],
    summary: 'Get a reusable block by id',
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
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const block = await getReusableBlockById(db, id);
    if (!block) return c.json({ error: 'Reusable block not found' }, 404);
    return c.json(toReusableBlock(block), 200);
  },
);

reusableBlocksRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Reusable blocks'],
    summary: 'Update a reusable block',
    middleware: requireReusableBlockWriteRole,
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateReusableBlockSchema } } },
    },
    responses: {
      200: {
        description: 'The updated reusable block.',
        content: { 'application/json': { schema: reusableBlockSchema } },
      },
      404: {
        description: 'No reusable block with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getReusableBlockById(db, id);
    if (!existing) return c.json({ error: 'Reusable block not found' }, 404);

    const input = c.req.valid('json');
    const block = await updateReusableBlock(db, id, input);
    c.executionCtx.waitUntil(invalidateAllPageCaches(db));
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'reusable_block.updated',
      targetType: 'reusable_block',
      targetId: id,
      metadata: { name: block!.name },
    });
    return c.json(toReusableBlock(block!), 200);
  },
);

reusableBlocksRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Reusable blocks'],
    summary: 'Delete a reusable block',
    middleware: requireReusableBlockWriteRole,
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The reusable block was deleted.' },
      404: {
        description: 'No reusable block with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getReusableBlockById(db, id);
    if (!existing) return c.json({ error: 'Reusable block not found' }, 404);

    await deleteReusableBlock(db, id);
    c.executionCtx.waitUntil(invalidateAllPageCaches(db));
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'reusable_block.deleted',
      targetType: 'reusable_block',
      targetId: id,
      metadata: { name: existing.name },
    });
    return c.body(null, 204);
  },
);
