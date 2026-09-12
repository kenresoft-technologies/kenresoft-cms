import { createRoute } from '@hono/zod-openapi';
import {
  createPageSchema,
  doesRoutePatternMatchLiteralRoute,
  idParamSchema,
  pageRevisionSchema,
  pageSchema,
  updatePageSchema,
  validateBlockTree,
} from '@kenresoft-cms/contracts';
import type { BlockInstance, Page, PageRevision } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { invalidatePublicPageCache } from '../../lib/public-cache';
import { requireRole } from '../../middleware/require-role';
import { listContentTypesWithRoutePattern } from '../../repositories/content-types';
import {
  createPage,
  deletePage,
  getPageById,
  getPageByRoute,
  listPageRevisions,
  listPages,
  restorePageRevision,
  updatePage,
} from '../../repositories/pages';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { Database, EntryStatus, Page as DbPage, PageRevision as DbPageRevision } from '@kenresoft-cms/database';

export const pagesRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const listQuerySchema = z.object({ status: z.enum(['draft', 'published']).optional() });
const idParam = idParamSchema;
const revisionParamsSchema = z.object({ id: z.string().min(1), revisionId: z.string().min(1) });

// Structural writes (admin/editor), matching the content-type-field floor rather than the
// looser entries floor — a Page's composition is closer to structure than day-to-day editorial
// content (§4.1).
const requirePageWriteRole = requireRole('admin', 'editor');

function toPage(row: DbPage): Page {
  return {
    id: row.id,
    route: row.route,
    title: row.title,
    status: row.status as EntryStatus,
    publishAt: row.publishAt ? row.publishAt.toISOString() : null,
    blocks: row.blocks.blocks,
    seo: row.seo ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPageRevision(row: DbPageRevision): PageRevision {
  return {
    id: row.id,
    pageId: row.pageId,
    title: row.title,
    status: row.status as EntryStatus,
    blocks: row.blocks.blocks,
    seo: row.seo ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

// Route-collision check, the content-type-pattern-side half of §4.3/§16: does any content
// type's own routePattern already claim this literal route? Checked in both directions —
// routes/admin/content-types.ts's own create/update already check the reverse (does a new
// routePattern match an existing Page's route) via findPageMatchingRoutePattern.
async function findConflictingRoutePattern(db: Database, route: string): Promise<string | null> {
  const withPatterns = await listContentTypesWithRoutePattern(db);
  const conflict = withPatterns.find(
    (contentType) => contentType.routePattern && doesRoutePatternMatchLiteralRoute(contentType.routePattern, route),
  );
  return conflict?.routePattern ?? null;
}

async function invalidateCacheForPage(route: string, previousRoute?: string): Promise<void> {
  await invalidatePublicPageCache(route);
  if (previousRoute && previousRoute !== route) {
    await invalidatePublicPageCache(previousRoute);
  }
}

pagesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Pages'],
    summary: 'List every page',
    request: { query: listQuerySchema },
    responses: {
      200: {
        description: 'Every page, optionally filtered by status.',
        content: { 'application/json': { schema: z.array(pageSchema) } },
      },
    },
  }),
  async (c) => {
    const { status } = c.req.valid('query');
    const db = getDb(c);
    const rows = await listPages(db, status);
    return c.json(rows.map(toPage), 200);
  },
);

pagesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Pages'],
    summary: 'Create a page',
    middleware: requirePageWriteRole,
    request: {
      body: { content: { 'application/json': { schema: createPageSchema } } },
    },
    responses: {
      201: {
        description: 'The created page.',
        content: { 'application/json': { schema: pageSchema } },
      },
      400: {
        description: 'The route is already used by another page or content-type route pattern, or a block in the tree is invalid.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);
    const userId = c.get('user').id;

    const blockError = validateBlockTree(input.blocks as BlockInstance[]);
    if (blockError) {
      return c.json({ error: blockError }, 400);
    }

    const routeCollision = await getPageByRoute(db, input.route);
    if (routeCollision) {
      return c.json({ error: 'That route is already used by another page.' }, 400);
    }
    const patternConflict = await findConflictingRoutePattern(db, input.route);
    if (patternConflict) {
      return c.json({ error: `That route is already claimed by the "${patternConflict}" content-type route pattern.` }, 400);
    }

    const page = await createPage(
      db,
      {
        route: input.route,
        title: input.title,
        status: input.status,
        blocks: { blocks: input.blocks },
        seo: input.seo ?? null,
        publishAt: input.publishAt ?? null,
      },
      userId,
    );
    c.executionCtx.waitUntil(invalidateCacheForPage(page.route));
    await recordAudit(db, {
      actorUserId: userId,
      action: 'page.created',
      targetType: 'page',
      targetId: page.id,
      metadata: { route: page.route, title: page.title },
    });
    if (page.status === 'published') {
      await recordAudit(db, {
        actorUserId: userId,
        action: 'page.published',
        targetType: 'page',
        targetId: page.id,
        metadata: { route: page.route },
      });
    }
    return c.json(toPage(page), 201);
  },
);

pagesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Pages'],
    summary: 'Get a page by id',
    request: { params: idParam },
    responses: {
      200: { description: 'The page.', content: { 'application/json': { schema: pageSchema } } },
      404: { description: 'No page with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const page = await getPageById(db, id);
    if (!page) return c.json({ error: 'Page not found' }, 404);
    return c.json(toPage(page), 200);
  },
);

pagesRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Pages'],
    summary: 'Update a page',
    middleware: requirePageWriteRole,
    request: {
      params: idParam,
      body: { content: { 'application/json': { schema: updatePageSchema } } },
    },
    responses: {
      200: { description: 'The updated page.', content: { 'application/json': { schema: pageSchema } } },
      400: {
        description: 'The route is already used by another page or content-type route pattern, or a block in the tree is invalid.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: { description: 'No page with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const userId = c.get('user').id;
    const existing = await getPageById(db, id);
    if (!existing) return c.json({ error: 'Page not found' }, 404);

    const input = c.req.valid('json');

    if (input.blocks) {
      const blockError = validateBlockTree(input.blocks as BlockInstance[]);
      if (blockError) return c.json({ error: blockError }, 400);
    }

    if (input.route && input.route !== existing.route) {
      const routeCollision = await getPageByRoute(db, input.route);
      if (routeCollision && routeCollision.id !== id) {
        return c.json({ error: 'That route is already used by another page.' }, 400);
      }
      const patternConflict = await findConflictingRoutePattern(db, input.route);
      if (patternConflict) {
        return c.json({ error: `That route is already claimed by the "${patternConflict}" content-type route pattern.` }, 400);
      }
    }

    const previousStatus = existing.status;
    const previousRoute = existing.route;
    const page = await updatePage(
      db,
      id,
      {
        route: input.route,
        title: input.title,
        status: input.status,
        blocks: input.blocks ? { blocks: input.blocks } : undefined,
        seo: 'seo' in input ? (input.seo ?? null) : undefined,
        publishAt: input.publishAt,
      },
      userId,
    );
    if (!page) return c.json({ error: 'Page not found' }, 404);

    c.executionCtx.waitUntil(invalidateCacheForPage(page.route, previousRoute));
    await recordAudit(db, {
      actorUserId: userId,
      action: 'page.updated',
      targetType: 'page',
      targetId: page.id,
      metadata: { route: page.route },
    });
    if (previousStatus !== 'published' && page.status === 'published') {
      await recordAudit(db, {
        actorUserId: userId,
        action: 'page.published',
        targetType: 'page',
        targetId: page.id,
        metadata: { route: page.route },
      });
    } else if (previousStatus === 'published' && page.status !== 'published') {
      await recordAudit(db, {
        actorUserId: userId,
        action: 'page.unpublished',
        targetType: 'page',
        targetId: page.id,
        metadata: { route: page.route },
      });
    }
    return c.json(toPage(page), 200);
  },
);

pagesRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Pages'],
    summary: 'Delete a page',
    middleware: requirePageWriteRole,
    request: { params: idParam },
    responses: {
      204: { description: 'The page was deleted.' },
      404: { description: 'No page with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const page = await getPageById(db, id);
    if (!page) return c.json({ error: 'Page not found' }, 404);

    await deletePage(db, id);
    c.executionCtx.waitUntil(invalidateCacheForPage(page.route));
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'page.deleted',
      targetType: 'page',
      targetId: page.id,
      metadata: { route: page.route },
    });
    return c.body(null, 204);
  },
);

pagesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/revisions',
    tags: ['Pages'],
    summary: "List a page's revision history",
    request: { params: idParam },
    responses: {
      200: {
        description: 'Every revision, newest first.',
        content: { 'application/json': { schema: z.array(pageRevisionSchema) } },
      },
      404: { description: 'No page with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const page = await getPageById(db, id);
    if (!page) return c.json({ error: 'Page not found' }, 404);
    const revisions = await listPageRevisions(db, page.id);
    return c.json(revisions.map(toPageRevision), 200);
  },
);

pagesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/revisions/{revisionId}/restore',
    tags: ['Pages'],
    summary: 'Restore a page to a past revision',
    middleware: requirePageWriteRole,
    request: { params: revisionParamsSchema },
    responses: {
      200: {
        description: 'The page, restored to the given revision (itself snapshotted first).',
        content: { 'application/json': { schema: pageSchema } },
      },
      404: {
        description: 'No page or revision matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, revisionId } = c.req.valid('param');
    const db = getDb(c);
    const userId = c.get('user').id;
    const existing = await getPageById(db, id);
    if (!existing) return c.json({ error: 'Page or revision not found' }, 404);

    const previousStatus = existing.status;
    const page = await restorePageRevision(db, id, revisionId, userId);
    if (!page) return c.json({ error: 'Page or revision not found' }, 404);

    c.executionCtx.waitUntil(invalidateCacheForPage(page.route));
    await recordAudit(db, {
      actorUserId: userId,
      action: 'page.restored',
      targetType: 'page',
      targetId: page.id,
      metadata: { route: page.route, revisionId },
    });
    if (previousStatus !== 'published' && page.status === 'published') {
      await recordAudit(db, {
        actorUserId: userId,
        action: 'page.published',
        targetType: 'page',
        targetId: page.id,
        metadata: { route: page.route },
      });
    } else if (previousStatus === 'published' && page.status !== 'published') {
      await recordAudit(db, {
        actorUserId: userId,
        action: 'page.unpublished',
        targetType: 'page',
        targetId: page.id,
        metadata: { route: page.route },
      });
    }
    return c.json(toPage(page), 200);
  },
);
