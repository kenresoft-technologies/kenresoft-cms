import { createRoute } from '@hono/zod-openapi';
import { createMediaFolderSchema, mediaFolderSchema, updateMediaFolderSchema } from '@kenresoft-cms/contracts';
import type { MediaFolder } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { invalidatePublicMediaFolderCache } from '../../lib/public-cache';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import {
  createMediaFolder,
  deleteMediaFolder,
  getMediaFolderById,
  getMediaFolderBySlug,
  listMediaFolders,
  updateMediaFolder,
} from '../../repositories/media-folders';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { MediaFolder as DbMediaFolder } from '@kenresoft-cms/database';

// Same role floor as Media itself (author/viewer can't manage media, §10).
export const mediaFoldersRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });

function toMediaFolder(row: DbMediaFolder): MediaFolder {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Rejects a parentId that doesn't exist, or that would create a cycle (moving/creating a folder
// as a descendant of itself) — mirrors entry-folders.ts's own identical guard.
async function validateParentId(
  db: ReturnType<typeof getDb>,
  folderId: string | null,
  parentId: string | null,
): Promise<string | null> {
  if (parentId === null) return null;
  if (parentId === folderId) return 'A folder cannot be its own parent';
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (folderId !== null && cursor === folderId) {
      return 'Cannot move a folder into one of its own descendants';
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const folder = await getMediaFolderById(db, cursor);
    if (!folder) return 'parentId does not reference a real media folder';
    cursor = folder.parentId;
  }
  return null;
}

mediaFoldersRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Media'],
    summary: 'List every media folder',
    responses: {
      200: {
        description: 'Every media folder, alphabetical.',
        content: { 'application/json': { schema: z.array(mediaFolderSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    return c.json((await listMediaFolders(db)).map(toMediaFolder), 200);
  },
);

mediaFoldersRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Media'],
    summary: 'Create a media folder',
    middleware: requireRole('admin', 'editor'),
    request: {
      body: { content: { 'application/json': { schema: createMediaFolderSchema } } },
    },
    responses: {
      201: {
        description: 'The created media folder.',
        content: { 'application/json': { schema: mediaFolderSchema } },
      },
      400: {
        description: 'A folder with that slug already exists.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);

    if (await getMediaFolderBySlug(db, input.slug)) {
      return c.json({ error: 'A media folder with that slug already exists' }, 400);
    }
    const parentError = await validateParentId(db, null, input.parentId ?? null);
    if (parentError) {
      return c.json({ error: parentError }, 400);
    }

    const created = await createMediaFolder(db, input);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'media_folder.created',
      targetType: 'media_folder',
      targetId: created.id,
      metadata: { name: created.name, slug: created.slug },
    });
    return c.json(toMediaFolder(created), 201);
  },
);

mediaFoldersRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Media'],
    summary: 'Rename a media folder or change its slug',
    middleware: requireRole('admin', 'editor'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateMediaFolderSchema } } },
    },
    responses: {
      200: {
        description: 'The updated media folder.',
        content: { 'application/json': { schema: mediaFolderSchema } },
      },
      400: {
        description: 'A different folder with that slug already exists.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: {
        description: 'No media folder with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = getDb(c);

    const existing = await getMediaFolderById(db, id);
    if (!existing) {
      return c.json({ error: 'Media folder not found' }, 404);
    }
    if (input.slug) {
      const bySlug = await getMediaFolderBySlug(db, input.slug);
      if (bySlug && bySlug.id !== id) {
        return c.json({ error: 'A media folder with that slug already exists' }, 400);
      }
    }
    if ('parentId' in input) {
      const parentError = await validateParentId(db, id, input.parentId ?? null);
      if (parentError) {
        return c.json({ error: parentError }, 400);
      }
    }

    const updated = await updateMediaFolder(db, id, input);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'media_folder.updated',
      targetType: 'media_folder',
      targetId: id,
      metadata: input,
    });
    await invalidatePublicMediaFolderCache(existing.slug);
    if (updated!.slug !== existing.slug) await invalidatePublicMediaFolderCache(updated!.slug);
    return c.json(toMediaFolder(updated!), 200);
  },
);

mediaFoldersRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Media'],
    summary: 'Delete a media folder — its media becomes unfiled, never deleted',
    middleware: requireRole('admin', 'editor'),
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The folder was deleted; any media in it is now unfiled.' },
      404: {
        description: 'No media folder with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);

    const existing = await getMediaFolderById(db, id);
    if (!existing) {
      return c.json({ error: 'Media folder not found' }, 404);
    }

    await deleteMediaFolder(db, id);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'media_folder.deleted',
      targetType: 'media_folder',
      targetId: id,
      metadata: { name: existing.name, slug: existing.slug },
    });
    await invalidatePublicMediaFolderCache(existing.slug);
    return c.body(null, 204);
  },
);
