import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import { getContentTypeBySlug } from '../../repositories/content-types';
import { getPublishedEntryBySlug, listPublishedEntriesForContentType } from '../../repositories/entries';

export const publicContentRoute = new Hono<{ Bindings: Bindings }>();

publicContentRoute.get('/:contentType', async (c) => {
  const db = getDb(c);
  const contentType = await getContentTypeBySlug(db, c.req.param('contentType'));
  if (!contentType) {
    return c.json({ error: 'Content type not found' }, 404);
  }

  return c.json(await listPublishedEntriesForContentType(db, contentType.id));
});

publicContentRoute.get('/:contentType/:slug', async (c) => {
  const db = getDb(c);
  const contentType = await getContentTypeBySlug(db, c.req.param('contentType'));
  if (!contentType) {
    return c.json({ error: 'Content type not found' }, 404);
  }

  const entry = await getPublishedEntryBySlug(db, contentType.id, c.req.param('slug'));
  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  return c.json(entry);
});
