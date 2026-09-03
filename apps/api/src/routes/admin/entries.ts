import { createRoute } from '@hono/zod-openapi';
import {
  createEntrySchema,
  entryRevisionSchema,
  entrySchema,
  entryWithContentTypeSchema,
  updateEntrySchema,
} from '@kenresoft-cms/contracts';
import type { Entry, EntryRevision, EntryStatus, EntryWithContentType } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import { invalidatePublicEntryCache } from '../../lib/public-cache';
import { dispatchWebhookEvent } from '../../lib/webhooks';
import { createOpenApiApp } from '../../lib/openapi';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import { getContentTypeById } from '../../repositories/content-types';
import {
  createEntry,
  deleteEntry,
  getEntryById,
  listEntriesWithContentType,
  listEntryRevisions,
  restoreEntryRevision,
  updateEntry,
} from '../../repositories/entries';
import type { EntryWithContentType as DbEntryWithContentType } from '../../repositories/entries';
import type { Database, Entry as DbEntry, EntryRevision as DbEntryRevision } from '@kenresoft-cms/database';

export const entriesRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const forbiddenSchema = z.object({ error: z.string() });

// author may create freely and view every entry (the list/get routes below have no role
// check), but can only write to entries they created themselves — admin and editor are
// unrestricted (§10). viewer never reaches here at all (blocked globally for every mutation).
function canWriteEntry(role: string, entry: Pick<DbEntry, 'createdBy'>, userId: string): boolean {
  if (role === 'author') return entry.createdBy === userId;
  return true;
}
// contentTypeId is optional: present -> entries for that one content type (unchanged
// behavior); absent -> every entry across every content type, joined with its content type
// and author (§ unified admin Entries view).
const listQuerySchema = z.object({ contentTypeId: z.string().min(1).optional() });
const createEntryQuerySchema = z.object({ contentTypeId: z.string().min(1) });
const idParamSchema = z.object({ id: z.string().min(1) });
const revisionParamsSchema = z.object({ id: z.string().min(1), revisionId: z.string().min(1) });

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

function toEntryWithContentType(row: DbEntryWithContentType): EntryWithContentType {
  return {
    ...toEntry(row),
    contentTypeName: row.contentTypeName,
    contentTypeSlug: row.contentTypeSlug,
    authorName: row.authorName,
    authorEmail: row.authorEmail,
  };
}

function toEntryRevision(row: DbEntryRevision): EntryRevision {
  return {
    id: row.id,
    entryId: row.entryId,
    slug: row.slug,
    status: row.status as EntryStatus,
    data: row.data,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

// Best-effort: every write to an entry could change what the public API's cached responses
// for its content type return (§13), so every write path below calls this regardless of the
// entry's actual status — deleting a cache key that was never populated is a harmless no-op.
async function invalidateCacheForEntry(
  db: Database,
  entry: Pick<DbEntry, 'contentTypeId' | 'slug'>,
): Promise<void> {
  const contentType = await getContentTypeById(db, entry.contentTypeId);
  if (!contentType) return;
  await invalidatePublicEntryCache(contentType.slug, entry.slug);
}

// Deliberately just the entry's identity/status, not its full `data` — keeps every delivered
// payload small and bounded regardless of entry size, and avoids handing an entry's complete
// content to every configured webhook by default. A subscriber that needs the full content can
// call the API back with entryId (its own credentials, its own access decision).
function webhookPayload(entry: Pick<DbEntry, 'id' | 'contentTypeId' | 'slug' | 'status'>) {
  return { entryId: entry.id, contentTypeId: entry.contentTypeId, slug: entry.slug, status: entry.status };
}

entriesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Entries'],
    summary: 'List entries for a content type, or every entry across every content type',
    request: { query: listQuerySchema },
    responses: {
      200: {
        description:
          'Entries for the given content type when contentTypeId is set, otherwise every ' +
          'entry across every content type — either way, each with its content type and ' +
          'author joined in.',
        content: { 'application/json': { schema: z.array(entryWithContentTypeSchema) } },
      },
    },
  }),
  async (c) => {
    const { contentTypeId } = c.req.valid('query');
    const db = getDb(c);
    const rows = await listEntriesWithContentType(db, contentTypeId);
    return c.json(rows.map(toEntryWithContentType), 200);
  },
);

entriesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Entries'],
    summary: 'Create an entry',
    request: {
      query: createEntryQuerySchema,
      body: { content: { 'application/json': { schema: createEntrySchema } } },
    },
    responses: {
      201: {
        description: 'The created entry.',
        content: { 'application/json': { schema: entrySchema } },
      },
      404: {
        description: 'No content type with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { contentTypeId } = c.req.valid('query');
    const input = c.req.valid('json');
    const db = getDb(c);
    try {
      const entry = await createEntry(db, contentTypeId, input, c.get('user').id);
      c.executionCtx.waitUntil(invalidateCacheForEntry(db, entry));
      dispatchWebhookEvent(db, c.executionCtx, 'entry.created', entry.contentTypeId, webhookPayload(entry));
      if (entry.status === 'published') {
        dispatchWebhookEvent(db, c.executionCtx, 'entry.published', entry.contentTypeId, webhookPayload(entry));
      }
      return c.json(toEntry(entry), 201);
    } catch {
      return c.json({ error: 'Content type not found' }, 404);
    }
  },
);

entriesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Entries'],
    summary: 'Get an entry by id',
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'The entry.',
        content: { 'application/json': { schema: entrySchema } },
      },
      404: {
        description: 'No entry with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const entry = await getEntryById(db, id);
    if (!entry) {
      return c.json({ error: 'Entry not found' }, 404);
    }
    return c.json(toEntry(entry), 200);
  },
);

entriesRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Entries'],
    summary: 'Update an entry',
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateEntrySchema } } },
    },
    responses: {
      200: {
        description: 'The updated entry.',
        content: { 'application/json': { schema: entrySchema } },
      },
      403: {
        description: "An author's entry belonging to a different user.",
        content: { 'application/json': { schema: forbiddenSchema } },
      },
      404: {
        description: 'No entry with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const user = c.get('user');
    const existing = await getEntryById(db, id);
    if (!existing) {
      return c.json({ error: 'Entry not found' }, 404);
    }
    if (!canWriteEntry(user.role, existing, user.id)) {
      return c.json({ error: "You can only edit entries you created" }, 403);
    }

    const input = c.req.valid('json');
    const previousStatus = existing.status;
    const entry = await updateEntry(db, id, input, user.id);
    if (!entry) {
      return c.json({ error: 'Entry not found' }, 404);
    }
    c.executionCtx.waitUntil(invalidateCacheForEntry(db, entry));
    dispatchWebhookEvent(db, c.executionCtx, 'entry.updated', entry.contentTypeId, webhookPayload(entry));
    if (previousStatus !== 'published' && entry.status === 'published') {
      dispatchWebhookEvent(db, c.executionCtx, 'entry.published', entry.contentTypeId, webhookPayload(entry));
    } else if (previousStatus === 'published' && entry.status !== 'published') {
      dispatchWebhookEvent(db, c.executionCtx, 'entry.unpublished', entry.contentTypeId, webhookPayload(entry));
    }
    return c.json(toEntry(entry), 200);
  },
);

entriesRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Entries'],
    summary: 'Delete an entry',
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The entry was deleted.' },
      403: {
        description: "An author's entry belonging to a different user.",
        content: { 'application/json': { schema: forbiddenSchema } },
      },
      404: {
        description: 'No entry with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const user = c.get('user');
    const entry = await getEntryById(db, id);
    if (!entry) {
      return c.json({ error: 'Entry not found' }, 404);
    }
    if (!canWriteEntry(user.role, entry, user.id)) {
      return c.json({ error: 'You can only delete entries you created' }, 403);
    }

    await deleteEntry(db, entry.id);
    c.executionCtx.waitUntil(invalidateCacheForEntry(db, entry));
    dispatchWebhookEvent(db, c.executionCtx, 'entry.deleted', entry.contentTypeId, webhookPayload(entry));
    return c.body(null, 204);
  },
);

entriesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/revisions',
    tags: ['Entries'],
    summary: "List an entry's revision history",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Every revision, newest first.',
        content: { 'application/json': { schema: z.array(entryRevisionSchema) } },
      },
      404: {
        description: 'No entry with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const entry = await getEntryById(db, id);
    if (!entry) {
      return c.json({ error: 'Entry not found' }, 404);
    }
    const revisions = await listEntryRevisions(db, entry.id);
    return c.json(revisions.map(toEntryRevision), 200);
  },
);

entriesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/revisions/{revisionId}/restore',
    tags: ['Entries'],
    summary: 'Restore an entry to a past revision',
    request: { params: revisionParamsSchema },
    responses: {
      200: {
        description: 'The entry, restored to the given revision (itself snapshotted first).',
        content: { 'application/json': { schema: entrySchema } },
      },
      403: {
        description: "An author's entry belonging to a different user.",
        content: { 'application/json': { schema: forbiddenSchema } },
      },
      404: {
        description: 'No entry or revision matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, revisionId } = c.req.valid('param');
    const db = getDb(c);
    const user = c.get('user');
    const existing = await getEntryById(db, id);
    if (!existing) {
      return c.json({ error: 'Entry or revision not found' }, 404);
    }
    if (!canWriteEntry(user.role, existing, user.id)) {
      return c.json({ error: 'You can only restore entries you created' }, 403);
    }

    const previousStatus = existing.status;
    const entry = await restoreEntryRevision(db, id, revisionId, user.id);
    if (!entry) {
      return c.json({ error: 'Entry or revision not found' }, 404);
    }
    c.executionCtx.waitUntil(invalidateCacheForEntry(db, entry));
    dispatchWebhookEvent(db, c.executionCtx, 'entry.updated', entry.contentTypeId, webhookPayload(entry));
    if (previousStatus !== 'published' && entry.status === 'published') {
      dispatchWebhookEvent(db, c.executionCtx, 'entry.published', entry.contentTypeId, webhookPayload(entry));
    } else if (previousStatus === 'published' && entry.status !== 'published') {
      dispatchWebhookEvent(db, c.executionCtx, 'entry.unpublished', entry.contentTypeId, webhookPayload(entry));
    }
    return c.json(toEntry(entry), 200);
  },
);
