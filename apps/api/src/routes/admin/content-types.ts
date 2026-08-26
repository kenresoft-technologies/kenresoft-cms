import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { parseJsonBody } from '../../lib/validate';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import {
  createContentType,
  getContentTypeById,
  listContentTypesForProject,
} from '../../repositories/content-types';
import {
  createFieldDefinition,
  listFieldDefinitionsForContentType,
} from '../../repositories/field-definitions';
import { createContentTypeSchema } from '../../validators/content-types';
import { createFieldDefinitionSchema } from '../../validators/field-definitions';

export const contentTypesRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

contentTypesRoute.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId query parameter is required' }, 400);
  }

  const db = getDb(c);
  return c.json(await listContentTypesForProject(db, projectId));
});

contentTypesRoute.post('/', async (c) => {
  const parsed = await parseJsonBody(c, createContentTypeSchema);
  if ('error' in parsed) return parsed.error;

  const db = getDb(c);
  const contentType = await createContentType(db, {
    ...parsed.data,
    description: parsed.data.description ?? null,
  });
  return c.json(contentType, 201);
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

  const field = await createFieldDefinition(db, {
    ...parsed.data,
    contentTypeId: contentType.id,
  });
  return c.json(field, 201);
});
