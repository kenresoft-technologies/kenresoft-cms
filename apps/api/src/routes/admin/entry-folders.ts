import { createRoute } from '@hono/zod-openapi';
import {
  createEntryFolderSchema,
  entryFolderSchema,
  entryWithContentTypeSchema,
  moveEntriesSchema,
  updateEntryFolderSchema,
} from '@kenresoft-cms/contracts';
import type { EntryFolder } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { getContentTypeById } from '../../repositories/content-types';
import {
  createEntryFolder,
  deleteEntryFolder,
  getEntryFolderById,
  getEntryFolderByName,
  listEntryFoldersForContentType,
  moveEntriesToFolder,
  updateEntryFolder,
} from '../../repositories/entry-folders';
import { getEntryById, listEntriesWithContentType } from '../../repositories/entries';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { Entry as DbEntry, EntryFolder as DbEntryFolder } from '@kenresoft-cms/database';

// No role gate beyond authentication (unlike media-folders.ts, which is admin/editor-only) —
// an entry folder organizes one content type's Entry instances, and entries themselves allow
// author to create/manage freely subject only to per-entry ownership (§10,
// routes/admin/entries.ts's own canWriteEntry) — folder create/rename/delete follow that same
// floor, and the move route below enforces per-entry ownership directly rather than gating the
// whole route at editor-and-above.
export const entryFoldersRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const forbiddenSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({ contentTypeId: z.string().min(1) });

function canWriteEntry(role: string, entry: Pick<DbEntry, 'createdBy'>, userId: string): boolean {
  if (role === 'author') return entry.createdBy === userId;
  return true;
}

function toEntryFolder(row: DbEntryFolder): EntryFolder {
  return {
    id: row.id,
    contentTypeId: row.contentTypeId,
    name: row.name,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

entryFoldersRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Entries'],
    summary: 'List every entry folder for a content type',
    request: { query: listQuerySchema },
    responses: {
      200: {
        description: 'Every folder belonging to the given content type, alphabetical.',
        content: { 'application/json': { schema: z.array(entryFolderSchema) } },
      },
      404: {
        description: 'No content type with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { contentTypeId } = c.req.valid('query');
    const db = getDb(c);
    const contentType = await getContentTypeById(db, contentTypeId);
    if (!contentType) {
      return c.json({ error: 'Content type not found' }, 404);
    }
    return c.json((await listEntryFoldersForContentType(db, contentTypeId)).map(toEntryFolder), 200);
  },
);

entryFoldersRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Entries'],
    summary: 'Create an entry folder',
    request: {
      query: listQuerySchema,
      body: { content: { 'application/json': { schema: createEntryFolderSchema } } },
    },
    responses: {
      201: {
        description: 'The created folder.',
        content: { 'application/json': { schema: entryFolderSchema } },
      },
      400: {
        description: 'A sibling folder with that name already exists, or parentId is invalid.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: {
        description: 'No content type with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { contentTypeId } = c.req.valid('query');
    const db = getDb(c);
    const contentType = await getContentTypeById(db, contentTypeId);
    if (!contentType) {
      return c.json({ error: 'Content type not found' }, 404);
    }

    const input = c.req.valid('json');
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      const parent = await getEntryFolderById(db, parentId);
      if (!parent || parent.contentTypeId !== contentTypeId) {
        return c.json({ error: 'parentId does not reference a folder in this content type' }, 400);
      }
    }
    if (await getEntryFolderByName(db, contentTypeId, parentId, input.name)) {
      return c.json({ error: 'A folder with that name already exists here' }, 400);
    }

    const created = await createEntryFolder(db, { contentTypeId, name: input.name, parentId });
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'entry_folder.created',
      targetType: 'entry_folder',
      targetId: created.id,
      metadata: { contentTypeId, name: created.name, parentId: created.parentId },
    });
    return c.json(toEntryFolder(created), 201);
  },
);

// Registered before /{id} below — Hono matches routes in registration order, and a POST to
// /move would otherwise be captured by /{id}'s own PATCH/DELETE registrations first if this were
// declared after them (a real ordering hazard this codebase has hit before; see the field-reorder
// route comment in routes/admin/content-types.ts).
entryFoldersRoute.openapi(
  createRoute({
    method: 'post',
    path: '/move',
    tags: ['Entries'],
    summary: 'Move one or more entries into a folder (or back to unfiled, folderId: null)',
    request: { body: { content: { 'application/json': { schema: moveEntriesSchema } } } },
    responses: {
      200: {
        description: 'Every entry that was actually moved.',
        content: { 'application/json': { schema: z.array(entryWithContentTypeSchema) } },
      },
      400: {
        description: 'folderId does not reference a real entry folder, or the entries span more than one content type.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      403: {
        description: "An author's entry belonging to a different user was included.",
        content: { 'application/json': { schema: forbiddenSchema } },
      },
    },
  }),
  async (c) => {
    const { entryIds, folderId } = c.req.valid('json');
    const db = getDb(c);
    const user = c.get('user');

    const entriesToMove = await Promise.all(entryIds.map((id) => getEntryById(db, id)));
    const existing = entriesToMove.filter((entry): entry is DbEntry => entry !== undefined);

    if (folderId !== null) {
      const folder = await getEntryFolderById(db, folderId);
      if (!folder) {
        return c.json({ error: 'folderId does not reference a real entry folder' }, 400);
      }
      const mismatched = existing.find((entry) => entry.contentTypeId !== folder.contentTypeId);
      if (mismatched) {
        return c.json({ error: 'Every entry must belong to the same content type as the target folder' }, 400);
      }
    }

    const forbidden = existing.find((entry) => !canWriteEntry(user.role, entry, user.id));
    if (forbidden) {
      return c.json({ error: 'You can only move entries you created' }, 403);
    }

    await moveEntriesToFolder(
      db,
      existing.map((entry) => entry.id),
      folderId,
    );
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'entries.moved',
      targetType: 'entry_folder',
      targetId: folderId ?? 'root',
      metadata: { entryIds: existing.map((entry) => entry.id), folderId },
    });

    const movedIds = new Set(existing.map((entry) => entry.id));
    const rows = existing.length
      ? (await listEntriesWithContentType(db, existing[0]!.contentTypeId)).filter((row) => movedIds.has(row.id))
      : [];
    return c.json(
      rows.map((row) => ({
        id: row.id,
        contentTypeId: row.contentTypeId,
        slug: row.slug,
        status: row.status,
        data: row.data,
        publishAt: row.publishAt ? row.publishAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        contentTypeName: row.contentTypeName,
        contentTypeSlug: row.contentTypeSlug,
        authorName: row.authorName,
        authorEmail: row.authorEmail,
        folderId: row.folderId,
      })),
      200,
    );
  },
);

entryFoldersRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Entries'],
    summary: 'Rename or reparent an entry folder',
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateEntryFolderSchema } } },
    },
    responses: {
      200: {
        description: 'The updated folder.',
        content: { 'application/json': { schema: entryFolderSchema } },
      },
      400: {
        description: 'A sibling folder with that name already exists, parentId is invalid, or the move would create a cycle.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: {
        description: 'No entry folder with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getEntryFolderById(db, id);
    if (!existing) {
      return c.json({ error: 'Entry folder not found' }, 404);
    }

    const input = c.req.valid('json');
    const nextParentId = 'parentId' in input ? (input.parentId ?? null) : existing.parentId;

    if (nextParentId !== null) {
      if (nextParentId === id) {
        return c.json({ error: 'A folder cannot be its own parent' }, 400);
      }
      const parent = await getEntryFolderById(db, nextParentId);
      if (!parent || parent.contentTypeId !== existing.contentTypeId) {
        return c.json({ error: 'parentId does not reference a folder in this content type' }, 400);
      }
      // Walk the candidate parent's own ancestor chain to reject a move that would create a
      // cycle (moving a folder into one of its own descendants).
      let cursor: string | null = parent.id;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id) {
          return c.json({ error: 'Cannot move a folder into one of its own descendants' }, 400);
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const cursorFolder = await getEntryFolderById(db, cursor);
        cursor = cursorFolder?.parentId ?? null;
      }
    }

    if (input.name && input.name !== existing.name) {
      const collision = await getEntryFolderByName(db, existing.contentTypeId, nextParentId, input.name);
      if (collision && collision.id !== id) {
        return c.json({ error: 'A folder with that name already exists here' }, 400);
      }
    }

    const updated = await updateEntryFolder(db, id, { name: input.name, parentId: nextParentId });
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'entry_folder.updated',
      targetType: 'entry_folder',
      targetId: id,
      metadata: { ...input },
    });
    return c.json(toEntryFolder(updated!), 200);
  },
);

entryFoldersRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Entries'],
    summary: 'Delete an entry folder — its entries become unfiled, its child folders move to root',
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The folder was deleted.' },
      404: {
        description: 'No entry folder with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getEntryFolderById(db, id);
    if (!existing) {
      return c.json({ error: 'Entry folder not found' }, 404);
    }

    await deleteEntryFolder(db, id);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'entry_folder.deleted',
      targetType: 'entry_folder',
      targetId: id,
      metadata: { contentTypeId: existing.contentTypeId, name: existing.name },
    });
    return c.body(null, 204);
  },
);
