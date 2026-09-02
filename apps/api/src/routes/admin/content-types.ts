import { createRoute } from '@hono/zod-openapi';
import {
  contentTypeSchema,
  createContentTypeSchema,
  createFieldDefinitionSchema,
  fieldDefinitionSchema,
  idParamSchema,
  reorderFieldDefinitionsSchema,
  updateContentTypeSchema,
  updateFieldDefinitionSchema,
} from '@kenresoft-cms/contracts';
import type { ContentType, FieldDefinition, FieldType } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import {
  createContentType,
  getContentTypeById,
  listContentTypes,
  updateContentType,
} from '../../repositories/content-types';
import {
  createFieldDefinition,
  deleteFieldDefinition,
  getFieldDefinitionById,
  listFieldDefinitionsForContentType,
  reorderFieldDefinitions,
  updateFieldDefinition,
} from '../../repositories/field-definitions';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { ContentType as DbContentType, FieldDefinition as DbFieldDefinition } from '@kenresoft-cms/database';

export const contentTypesRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const fieldParamSchema = z.object({ id: z.string().min(1), fieldId: z.string().min(1) });

function toContentType(row: DbContentType): ContentType {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toFieldDefinition(row: DbFieldDefinition): FieldDefinition {
  return {
    id: row.id,
    contentTypeId: row.contentTypeId,
    name: row.name,
    label: row.label,
    fieldType: row.fieldType as FieldType,
    required: row.required,
    sortOrder: row.sortOrder,
    config: row.config ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

contentTypesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Content types'],
    summary: 'List every content type',
    responses: {
      200: {
        description: 'Every content type.',
        content: { 'application/json': { schema: z.array(contentTypeSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    return c.json((await listContentTypes(db)).map(toContentType), 200);
  },
);

// Content types are the top-level structural resource now that Projects are gone (§11) —
// creating one is an admin-level action, same as project creation was before. ("Admin," not
// "Owner" specifically — Owner is a distinct role above Admin (§10) that also satisfies this
// gate, not the only role that can.)
contentTypesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Content types'],
    summary: 'Create a content type (admin only)',
    middleware: requireRole('admin'),
    request: {
      body: { content: { 'application/json': { schema: createContentTypeSchema } } },
    },
    responses: {
      201: {
        description: 'The created content type.',
        content: { 'application/json': { schema: contentTypeSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);
    const contentType = await createContentType(db, {
      ...input,
      description: input.description ?? null,
    });
    return c.json(toContentType(contentType), 201);
  },
);

contentTypesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Content types'],
    summary: 'Get a content type by id',
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'The content type.',
        content: { 'application/json': { schema: contentTypeSchema } },
      },
      404: {
        description: 'No content type with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const contentType = await getContentTypeById(db, id);
    if (!contentType) {
      return c.json({ error: 'Content type not found' }, 404);
    }
    return c.json(toContentType(contentType), 200);
  },
);

// Admin-gated, same as creation — renaming/re-slugging a content type is a structural change,
// not an editorial one (§11). Changing the slug doesn't cascade-invalidate the public cache
// for entries under the old slug; those simply expire on the existing 5-minute TTL (§12) —
// not worth extra invalidation machinery for an action this infrequent.
contentTypesRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Content types'],
    summary: 'Update a content type (admin only)',
    middleware: requireRole('admin'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateContentTypeSchema } } },
    },
    responses: {
      200: {
        description: 'The updated content type.',
        content: { 'application/json': { schema: contentTypeSchema } },
      },
      404: {
        description: 'No content type with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getContentTypeById(db, id);
    if (!existing) {
      return c.json({ error: 'Content type not found' }, 404);
    }

    const input = c.req.valid('json');
    const updated = await updateContentType(db, id, input);
    return c.json(toContentType(updated!), 200);
  },
);

contentTypesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/fields',
    tags: ['Content types'],
    summary: "List a content type's field definitions",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Every field definition, in display order.',
        content: { 'application/json': { schema: z.array(fieldDefinitionSchema) } },
      },
      404: {
        description: 'No content type with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const contentType = await getContentTypeById(db, id);
    if (!contentType) {
      return c.json({ error: 'Content type not found' }, 404);
    }

    const fields = await listFieldDefinitionsForContentType(db, contentType.id);
    return c.json(fields.map(toFieldDefinition), 200);
  },
);

contentTypesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/fields',
    tags: ['Content types'],
    summary: 'Add a field definition to a content type',
    middleware: requireRole('admin', 'editor'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: createFieldDefinitionSchema } } },
    },
    responses: {
      201: {
        description: 'The created field definition.',
        content: { 'application/json': { schema: fieldDefinitionSchema } },
      },
      404: {
        description: 'No content type with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const contentType = await getContentTypeById(db, id);
    if (!contentType) {
      return c.json({ error: 'Content type not found' }, 404);
    }

    const input = c.req.valid('json');
    const existingFields = await listFieldDefinitionsForContentType(db, contentType.id);
    const field = await createFieldDefinition(db, {
      ...input,
      contentTypeId: contentType.id,
      sortOrder: input.sortOrder ?? existingFields.length,
    });
    return c.json(toFieldDefinition(field), 201);
  },
);

// Registered before /{id}/fields/{fieldId} below — Hono matches routes in registration
// order, and a PATCH to /fields/reorder would otherwise be captured by that route first,
// with "reorder" bound to :fieldId (a real regression this exact ordering caused once
// already, caught by the existing field-reorder.test.ts).
contentTypesRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/fields/reorder',
    tags: ['Content types'],
    summary: "Reorder a content type's field definitions",
    middleware: requireRole('admin', 'editor'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: reorderFieldDefinitionsSchema } } },
    },
    responses: {
      200: {
        description: 'Every field definition in its new order.',
        content: { 'application/json': { schema: z.array(fieldDefinitionSchema) } },
      },
      400: {
        description: "fieldIds didn't exactly match the content type's existing fields.",
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: {
        description: 'No content type with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const contentType = await getContentTypeById(db, id);
    if (!contentType) {
      return c.json({ error: 'Content type not found' }, 404);
    }

    const { fieldIds } = c.req.valid('json');
    try {
      const fields = await reorderFieldDefinitions(db, contentType.id, fieldIds);
      return c.json(fields.map(toFieldDefinition), 200);
    } catch {
      return c.json({ error: "fieldIds must exactly match this content type's existing fields" }, 400);
    }
  },
);

// admin/editor — matches field creation just above (adding/editing a field is treated as an
// editorial action on this content type's shape, not a structural one like creating the
// content type itself, but still above author/viewer).
contentTypesRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/fields/{fieldId}',
    tags: ['Content types'],
    summary: 'Update a field definition',
    middleware: requireRole('admin', 'editor'),
    request: {
      params: fieldParamSchema,
      body: { content: { 'application/json': { schema: updateFieldDefinitionSchema } } },
    },
    responses: {
      200: {
        description: 'The updated field definition.',
        content: { 'application/json': { schema: fieldDefinitionSchema } },
      },
      404: {
        description: 'No content type or field matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, fieldId } = c.req.valid('param');
    const db = getDb(c);
    const field = await getFieldDefinitionById(db, fieldId);
    if (!field || field.contentTypeId !== id) {
      return c.json({ error: 'Field not found' }, 404);
    }

    const input = c.req.valid('json');
    const updated = await updateFieldDefinition(db, fieldId, input);
    return c.json(toFieldDefinition(updated!), 200);
  },
);

contentTypesRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/fields/{fieldId}',
    tags: ['Content types'],
    summary: 'Delete a field definition',
    middleware: requireRole('admin', 'editor'),
    request: { params: fieldParamSchema },
    responses: {
      204: { description: 'The field was deleted.' },
      404: {
        description: 'No content type or field matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, fieldId } = c.req.valid('param');
    const db = getDb(c);
    const field = await getFieldDefinitionById(db, fieldId);
    if (!field || field.contentTypeId !== id) {
      return c.json({ error: 'Field not found' }, 404);
    }

    await deleteFieldDefinition(db, fieldId);
    return c.body(null, 204);
  },
);
