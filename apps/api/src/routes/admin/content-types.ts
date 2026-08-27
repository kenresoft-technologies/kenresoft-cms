import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { parseJsonBody } from '../../lib/validate';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import { requireRole } from '../../middleware/require-role';
import {
  createContentType,
  getContentTypeById,
  listContentTypes,
} from '../../repositories/content-types';
import {
  createFieldDefinition,
  listFieldDefinitionsForContentType,
  reorderFieldDefinitions,
} from '../../repositories/field-definitions';
import { createContentTypeSchema } from '../../validators/content-types';
import { createFieldDefinitionSchema, reorderFieldDefinitionsSchema } from '../../validators/field-definitions';

export const contentTypesRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

contentTypesRoute.get('/', async (c) => {
  const db = getDb(c);
  return c.json(await listContentTypes(db));
});

// Content types are the top-level structural resource now that Projects are gone (§11) —
// creating one is an owner-level action, same as project creation was before.
contentTypesRoute.post('/', requireRole('owner'), async (c) => {
  const parsed = await parseJsonBody(c, createContentTypeSchema);
  if ('error' in parsed) return parsed.error;

  const db = getDb(c);
  const contentType = await createContentType(db, {
    ...parsed.data,
    description: parsed.data.description ?? null,
  });
  return c.json(contentType, 201);
});

contentTypesRoute.get('/:id', async (c) => {
  const db = getDb(c);
  const contentType = await getContentTypeById(db, c.req.param('id'));
  if (!contentType) {
    return c.json({ error: 'Content type not found' }, 404);
  }
  return c.json(contentType);
});

contentTypesRoute.get('/:id/fields', async (c) => {
  const db = getDb(c);
  const contentType = await getContentTypeById(db, c.req.param('id'));
  if (!contentType) {
    return c.json({ error: 'Content type not found' }, 404);
  }

  return c.json(await listFieldDefinitionsForContentType(db, contentType.id));
});

contentTypesRoute.post('/:id/fields', async (c) => {
  const db = getDb(c);
  const contentType = await getContentTypeById(db, c.req.param('id'));
  if (!contentType) {
    return c.json({ error: 'Content type not found' }, 404);
  }

  const parsed = await parseJsonBody(c, createFieldDefinitionSchema);
  if ('error' in parsed) return parsed.error;

  const existingFields = await listFieldDefinitionsForContentType(db, contentType.id);
  const field = await createFieldDefinition(db, {
    ...parsed.data,
    contentTypeId: contentType.id,
    sortOrder: parsed.data.sortOrder ?? existingFields.length,
  });
  return c.json(field, 201);
});

contentTypesRoute.patch('/:id/fields/reorder', async (c) => {
  const db = getDb(c);
  const contentType = await getContentTypeById(db, c.req.param('id'));
  if (!contentType) {
    return c.json({ error: 'Content type not found' }, 404);
  }

  const parsed = await parseJsonBody(c, reorderFieldDefinitionsSchema);
  if ('error' in parsed) return parsed.error;

  try {
    const fields = await reorderFieldDefinitions(db, contentType.id, parsed.data.fieldIds);
    return c.json(fields);
  } catch {
    return c.json({ error: 'fieldIds must exactly match this content type\'s existing fields' }, 400);
  }
});
