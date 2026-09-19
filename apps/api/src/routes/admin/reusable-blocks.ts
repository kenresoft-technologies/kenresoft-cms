import { createRoute } from '@hono/zod-openapi';
import {
  BLOCK_CONFIG_SCHEMAS,
  createReusableBlockSchema,
  idParamSchema,
  reusableBlockSchema,
  updateReusableBlockSchema,
} from '@kenresoft-cms/contracts';
import type { ReusableBlock } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { sanitizeReusableBlockConfig } from '../../lib/raw-html-guard';
import { invalidateAllPageCaches } from '../../lib/page-cache';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { invalidatePublicReusableBlockCache } from '../../lib/public-cache';
import { requireRole } from '../../middleware/require-role';
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

// A production-hardening fix (docs/SITE_BUILDER.md §24's follow-up pass): unlike Pages/
// Templates, which run every block through `validateBlockTree()` (per-block-type `config`
// schema, `.strict()` — rejects unknown keys, enforces length/type limits), this route only
// ever validated `config` as an untyped `z.record()` via `createReusableBlockSchema`/
// `updateReusableBlockSchema` — a real gap, not a documented decision, since a reusable block's
// config is rendered through the exact same per-type block component as a Page's own inline
// block (`BlockRenderer.astro`'s `reusableBlockRef` special-case). Validates against the
// *merged* type+config (not just whichever fields a PATCH happens to include), since changing
// only `type` while leaving a stale `config` shaped for the old type would otherwise slip past
// an unvalidated PATCH.
function validateReusableBlockConfig(type: ReusableBlock['type'], config: Record<string, unknown>): string | null {
  const result = BLOCK_CONFIG_SCHEMAS[type].safeParse(config);
  if (!result.success) {
    return `Invalid config for a "${type}" reusable block: ${result.error.issues[0]?.message ?? 'invalid'}`;
  }
  return null;
}

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
      400: {
        description: "The config doesn't match this block type's own shape.",
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);
    const configError = validateReusableBlockConfig(input.type, input.config);
    if (configError) return c.json({ error: configError }, 400);
    const block = await createReusableBlock(db, {
      ...input,
      config: sanitizeReusableBlockConfig(input.type, input.config),
    });
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
      400: {
        description: "The config doesn't match this block type's own shape.",
        content: { 'application/json': { schema: notFoundSchema } },
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
    // Validates what will actually end up stored: a partial update only overwrites the fields
    // it includes (repositories/reusable-blocks.ts's `.set({...patch})`), so a `type` change
    // with no accompanying `config` would otherwise leave the old type's config fields in place
    // — validating the merged result (not just whichever fields this one PATCH happens to
    // include) means that combination is correctly rejected rather than silently corrupted.
    const mergedType = (input.type ?? existing.type) as ReusableBlock['type'];
    const mergedConfig = input.config ?? existing.config;
    const configError = validateReusableBlockConfig(mergedType, mergedConfig);
    if (configError) return c.json({ error: configError }, 400);

    const block = await updateReusableBlock(db, id, {
      ...input,
      ...(input.config ? { config: sanitizeReusableBlockConfig(mergedType, input.config) } : {}),
    });
    c.executionCtx.waitUntil(invalidateAllPageCaches(db));
    c.executionCtx.waitUntil(invalidatePublicReusableBlockCache(id));
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
    c.executionCtx.waitUntil(invalidatePublicReusableBlockCache(id));
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
