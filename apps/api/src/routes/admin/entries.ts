import { createRoute } from '@hono/zod-openapi';
import {
  contentTypeExportSchema,
  createEntrySchema,
  entryRevisionSchema,
  entrySchema,
  entryWithContentTypeSchema,
  importEntriesResultSchema,
  importEntriesSchema,
  previewTokenResponseSchema,
  updateEntrySchema,
} from '@kenresoft-cms/contracts';
import type { Entry, EntryRevision, EntryStatus, EntryWithContentType } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { invalidatePublicEntryCache } from '../../lib/public-cache';
import { signPreviewToken } from '../../lib/preview-token';
import { dispatchWebhookEvent } from '../../lib/webhooks';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import { getContentTypeById } from '../../repositories/content-types';
import {
  createEntry,
  deleteEntry,
  getEntryById,
  getEntryBySlug,
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
const contentTypeScopedQuerySchema = z.object({ contentTypeId: z.string().min(1) });
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

async function auditEntryChange(
  db: Database,
  actorUserId: string,
  action: string,
  entry: Pick<DbEntry, 'id' | 'contentTypeId' | 'slug'>,
): Promise<void> {
  await recordAudit(db, {
    actorUserId,
    action,
    targetType: 'entry',
    targetId: entry.id,
    metadata: { contentTypeId: entry.contentTypeId, slug: entry.slug },
  });
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
    const userId = c.get('user').id;
    try {
      const entry = await createEntry(db, contentTypeId, input, userId);
      c.executionCtx.waitUntil(invalidateCacheForEntry(db, entry));
      dispatchWebhookEvent(db, c.executionCtx, 'entry.created', entry.contentTypeId, webhookPayload(entry));
      await auditEntryChange(db, userId, 'entry.created', entry);
      if (entry.status === 'published') {
        dispatchWebhookEvent(db, c.executionCtx, 'entry.published', entry.contentTypeId, webhookPayload(entry));
        await auditEntryChange(db, userId, 'entry.published', entry);
      }
      return c.json(toEntry(entry), 201);
    } catch {
      return c.json({ error: 'Content type not found' }, 404);
    }
  },
);

// Registered before /{id} below — Hono matches routes in registration order, and a GET to
// /export would otherwise be captured by /{id} first, the same ordering hazard already
// documented on the field-reorder route in routes/admin/content-types.ts.
entriesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/export',
    tags: ['Entries'],
    summary: 'Export every entry for a content type as portable JSON',
    request: { query: contentTypeScopedQuerySchema },
    responses: {
      200: {
        description: "The content type's identity plus every one of its entries.",
        content: { 'application/json': { schema: contentTypeExportSchema } },
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

    const rows = await listEntriesWithContentType(db, contentTypeId);
    return c.json(
      {
        contentType: { name: contentType.name, slug: contentType.slug },
        exportedAt: new Date().toISOString(),
        entries: rows.map((row) => ({
          slug: row.slug,
          status: row.status as EntryStatus,
          data: row.data,
          publishAt: row.publishAt ? row.publishAt.toISOString() : null,
        })),
      },
      200,
    );
  },
);

// admin/editor only — a bulk import writes entries regardless of who created them, bypassing
// the per-entry author-ownership check (canWriteEntry) that every other write route above
// enforces, so it's gated at the same level as content-type/field structural changes rather
// than left open to every non-viewer role like the single-entry write routes above.
entriesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/import',
    tags: ['Entries'],
    summary: 'Bulk-import entries into a content type from a previous export',
    middleware: requireRole('admin', 'editor'),
    request: {
      query: contentTypeScopedQuerySchema,
      body: { content: { 'application/json': { schema: importEntriesSchema } } },
    },
    responses: {
      200: {
        description: 'Import summary — how many entries were created, updated, or failed.',
        content: { 'application/json': { schema: importEntriesResultSchema } },
      },
      400: {
        description: 'The import file was exported from a different content type.',
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
    if (input.contentType && input.contentType.slug !== contentType.slug) {
      return c.json(
        { error: `This file was exported from "${input.contentType.slug}", not "${contentType.slug}"` },
        400,
      );
    }

    const userId = c.get('user').id;
    let created = 0;
    let updated = 0;
    const errors: { slug: string; error: string }[] = [];

    for (const item of input.entries) {
      try {
        const existing = await getEntryBySlug(db, contentTypeId, item.slug);
        const publishAt = item.publishAt ? new Date(item.publishAt) : null;
        const entry = existing
          ? await updateEntry(db, existing.id, { status: item.status, data: item.data, publishAt }, userId)
          : await createEntry(db, contentTypeId, { slug: item.slug, status: item.status, data: item.data, publishAt }, userId);
        if (!entry) continue;

        if (existing) updated++;
        else created++;
        c.executionCtx.waitUntil(invalidateCacheForEntry(db, entry));
        dispatchWebhookEvent(
          db,
          c.executionCtx,
          existing ? 'entry.updated' : 'entry.created',
          entry.contentTypeId,
          webhookPayload(entry),
        );
        await auditEntryChange(db, userId, existing ? 'entry.updated' : 'entry.created', entry);
      } catch (err) {
        errors.push({ slug: item.slug, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return c.json({ created, updated, errors }, 200);
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

// No role gate beyond authentication — a read-only capability (generating a signed token proves
// nothing and writes nothing) matching entries' own GET routes above, available to viewer too
// like any other read. The token itself, not this route, is what actually gates access to the
// entry's content: apps/api/src/lib/preview-token.ts, routes/public/preview.ts.
entriesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/preview-token',
    tags: ['Entries'],
    summary: 'Generate a signed, time-limited Live Preview token for this entry',
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'A token valid for 15 minutes, usable once against the public preview route.',
        content: { 'application/json': { schema: previewTokenResponseSchema } },
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
    const { token, expiresAt } = await signPreviewToken(c.env.BETTER_AUTH_SECRET, entry.id);
    return c.json({ token, expiresAt: expiresAt.toISOString() }, 200);
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
    await auditEntryChange(db, user.id, 'entry.updated', entry);
    if (previousStatus !== 'published' && entry.status === 'published') {
      dispatchWebhookEvent(db, c.executionCtx, 'entry.published', entry.contentTypeId, webhookPayload(entry));
      await auditEntryChange(db, user.id, 'entry.published', entry);
    } else if (previousStatus === 'published' && entry.status !== 'published') {
      dispatchWebhookEvent(db, c.executionCtx, 'entry.unpublished', entry.contentTypeId, webhookPayload(entry));
      await auditEntryChange(db, user.id, 'entry.unpublished', entry);
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
    await auditEntryChange(db, user.id, 'entry.deleted', entry);
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
    await auditEntryChange(db, user.id, 'entry.restored', entry);
    if (previousStatus !== 'published' && entry.status === 'published') {
      dispatchWebhookEvent(db, c.executionCtx, 'entry.published', entry.contentTypeId, webhookPayload(entry));
      await auditEntryChange(db, user.id, 'entry.published', entry);
    } else if (previousStatus === 'published' && entry.status !== 'published') {
      dispatchWebhookEvent(db, c.executionCtx, 'entry.unpublished', entry.contentTypeId, webhookPayload(entry));
      await auditEntryChange(db, user.id, 'entry.unpublished', entry);
    }
    return c.json(toEntry(entry), 200);
  },
);
