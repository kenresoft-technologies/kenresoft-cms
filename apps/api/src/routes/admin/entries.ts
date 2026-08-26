import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { invalidatePublicEntryCache } from '../../lib/public-cache';
import { parseJsonBody } from '../../lib/validate';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import { getContentTypeById } from '../../repositories/content-types';
import {
  createEntry,
  deleteEntry,
  getEntryById,
  listEntriesForContentType,
  listEntryRevisions,
  restoreEntryRevision,
  updateEntry,
} from '../../repositories/entries';
import { createEntrySchema, updateEntrySchema } from '../../validators/entries';
import type { Database, Entry } from '@kenresoft/database';

export const entriesRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

// Best-effort: every write to an entry could change what the public API's cached responses
// for its content type return (§13), so every write path below calls this regardless of the
// entry's actual status — deleting a cache key that was never populated is a harmless no-op.
async function invalidateCacheForEntry(
  db: Database,
  entry: Pick<Entry, 'contentTypeId' | 'slug'>,
): Promise<void> {
  const contentType = await getContentTypeById(db, entry.contentTypeId);
  if (!contentType) return;
  await invalidatePublicEntryCache(contentType.slug, entry.slug);
}

entriesRoute.get('/', async (c) => {
  const contentTypeId = c.req.query('contentTypeId');
  if (!contentTypeId) {
    return c.json({ error: 'contentTypeId query parameter is required' }, 400);
  }

  const db = getDb(c);
  return c.json(await listEntriesForContentType(db, contentTypeId));
});

entriesRoute.post('/', async (c) => {
  const contentTypeId = c.req.query('contentTypeId');
  if (!contentTypeId) {
    return c.json({ error: 'contentTypeId query parameter is required' }, 400);
  }

  const parsed = await parseJsonBody(c, createEntrySchema);
  if ('error' in parsed) return parsed.error;

  const db = getDb(c);
  try {
    const entry = await createEntry(db, contentTypeId, parsed.data, c.get('user').id);
    c.executionCtx.waitUntil(invalidateCacheForEntry(db, entry));
    return c.json(entry, 201);
  } catch {
    return c.json({ error: 'Content type not found' }, 404);
  }
});

entriesRoute.get('/:id', async (c) => {
  const db = getDb(c);
  const entry = await getEntryById(db, c.req.param('id'));
  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  return c.json(entry);
});

entriesRoute.patch('/:id', async (c) => {
  const parsed = await parseJsonBody(c, updateEntrySchema);
  if ('error' in parsed) return parsed.error;

  const db = getDb(c);
  const entry = await updateEntry(db, c.req.param('id'), parsed.data, c.get('user').id);
  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  c.executionCtx.waitUntil(invalidateCacheForEntry(db, entry));
  return c.json(entry);
});

entriesRoute.delete('/:id', async (c) => {
  const db = getDb(c);
  const entry = await getEntryById(db, c.req.param('id'));
  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  await deleteEntry(db, entry.id);
  c.executionCtx.waitUntil(invalidateCacheForEntry(db, entry));
  return c.body(null, 204);
});

entriesRoute.get('/:id/revisions', async (c) => {
  const db = getDb(c);
  const entry = await getEntryById(db, c.req.param('id'));
  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  return c.json(await listEntryRevisions(db, entry.id));
});

entriesRoute.post('/:id/revisions/:revisionId/restore', async (c) => {
  const db = getDb(c);
  const entry = await restoreEntryRevision(
    db,
    c.req.param('id'),
    c.req.param('revisionId'),
    c.get('user').id,
  );
  if (!entry) {
    return c.json({ error: 'Entry or revision not found' }, 404);
  }
  c.executionCtx.waitUntil(invalidateCacheForEntry(db, entry));
  return c.json(entry);
});
