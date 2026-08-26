import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { parseJsonBody } from '../../lib/validate';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import {
  createEntry,
  deleteEntry,
  getEntryById,
  listEntriesForContentType,
  updateEntry,
} from '../../repositories/entries';
import { createEntrySchema, updateEntrySchema } from '../../validators/entries';

export const entriesRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

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
    const entry = await createEntry(db, contentTypeId, parsed.data);
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
  const entry = await updateEntry(db, c.req.param('id'), parsed.data);
  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  return c.json(entry);
});

entriesRoute.delete('/:id', async (c) => {
  const db = getDb(c);
  const deleted = await deleteEntry(db, c.req.param('id'));
  if (!deleted) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  return c.body(null, 204);
});
