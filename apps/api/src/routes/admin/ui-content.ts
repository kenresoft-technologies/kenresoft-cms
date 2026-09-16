import { createRoute } from '@hono/zod-openapi';
import {
  createUiContentItemSchema,
  createUiContentTypeSchema,
  uiContentItemSchema,
  uiContentTypeSchema,
  updateUiContentItemSchema,
  updateUiContentTypeSchema,
} from '@kenresoft-cms/contracts';
import type { UiContentItem, UiContentType } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { invalidatePublicUiContentCache, invalidatePublicUiContentTypeCache } from '../../lib/public-cache';
import { validateUiContentData } from '../../lib/ui-content-validation';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import {
  createUiContentItem,
  createUiContentType,
  deleteUiContentItem,
  deleteUiContentType,
  getUiContentItemById,
  getUiContentItemBySlug,
  getUiContentTypeById,
  getUiContentTypeBySlug,
  listUiContentItems,
  listUiContentTypes,
  updateUiContentItem,
  updateUiContentType,
} from '../../repositories/ui-content';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { UiContentItem as DbUiContentItem, UiContentType as DbUiContentType } from '@kenresoft-cms/database';

// UI Content types/items are structural-ish (a type's field shape affects every item under it),
// so this follows content-types' own field-management floor (admin/editor) — same as content
// type field CRUD, stricter than plain entry writes.
export const uiContentRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });
const typeItemParamSchema = z.object({ typeId: z.string().min(1), itemId: z.string().min(1) });

function toUiContentType(row: DbUiContentType): UiContentType {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    fields: row.fields,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toUiContentItem(row: DbUiContentItem): UiContentItem {
  return {
    id: row.id,
    uiContentTypeId: row.uiContentTypeId,
    slug: row.slug,
    data: row.data,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

uiContentRoute.openapi(
  createRoute({
    method: 'get',
    path: '/types',
    tags: ['UI Content'],
    summary: 'List every UI content type',
    responses: {
      200: { description: 'Every UI content type.', content: { 'application/json': { schema: z.array(uiContentTypeSchema) } } },
    },
  }),
  async (c) => c.json((await listUiContentTypes(getDb(c))).map(toUiContentType), 200),
);

uiContentRoute.openapi(
  createRoute({
    method: 'post',
    path: '/types',
    tags: ['UI Content'],
    summary: 'Create a UI content type',
    middleware: requireRole('admin', 'editor'),
    request: { body: { content: { 'application/json': { schema: createUiContentTypeSchema } } } },
    responses: {
      201: { description: 'The created UI content type.', content: { 'application/json': { schema: uiContentTypeSchema } } },
      400: { description: 'A type with that slug already exists.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);
    if (await getUiContentTypeBySlug(db, input.slug)) {
      return c.json({ error: 'A UI content type with that slug already exists' }, 400);
    }
    const created = await createUiContentType(db, { name: input.name, slug: input.slug, fields: input.fields ?? [] });
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'ui_content_type.created',
      targetType: 'ui_content_type',
      targetId: created.id,
      metadata: { name: created.name, slug: created.slug },
    });
    return c.json(toUiContentType(created), 201);
  },
);

uiContentRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/types/{id}',
    tags: ['UI Content'],
    summary: 'Update a UI content type',
    middleware: requireRole('admin', 'editor'),
    request: { params: idParamSchema, body: { content: { 'application/json': { schema: updateUiContentTypeSchema } } } },
    responses: {
      200: { description: 'The updated UI content type.', content: { 'application/json': { schema: uiContentTypeSchema } } },
      400: { description: 'A different type with that slug already exists.', content: { 'application/json': { schema: notFoundSchema } } },
      404: { description: 'No UI content type with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = getDb(c);

    const existing = await getUiContentTypeById(db, id);
    if (!existing) return c.json({ error: 'UI content type not found' }, 404);
    if (input.slug) {
      const bySlug = await getUiContentTypeBySlug(db, input.slug);
      if (bySlug && bySlug.id !== id) return c.json({ error: 'A UI content type with that slug already exists' }, 400);
    }

    const updated = await updateUiContentType(db, id, input);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'ui_content_type.updated',
      targetType: 'ui_content_type',
      targetId: id,
      metadata: { name: input.name, slug: input.slug },
    });
    await invalidatePublicUiContentTypeCache(existing.slug);
    if (updated!.slug !== existing.slug) await invalidatePublicUiContentTypeCache(updated!.slug);
    return c.json(toUiContentType(updated!), 200);
  },
);

uiContentRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/types/{id}',
    tags: ['UI Content'],
    summary: 'Delete a UI content type and every item under it',
    middleware: requireRole('admin', 'editor'),
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The type (and its items) was deleted.' },
      404: { description: 'No UI content type with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getUiContentTypeById(db, id);
    if (!existing) return c.json({ error: 'UI content type not found' }, 404);

    await deleteUiContentType(db, id);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'ui_content_type.deleted',
      targetType: 'ui_content_type',
      targetId: id,
      metadata: { name: existing.name, slug: existing.slug },
    });
    await invalidatePublicUiContentTypeCache(existing.slug);
    return c.body(null, 204);
  },
);

uiContentRoute.openapi(
  createRoute({
    method: 'get',
    path: '/types/{typeId}/items',
    tags: ['UI Content'],
    summary: 'List every item of a UI content type',
    request: { params: z.object({ typeId: z.string().min(1) }) },
    responses: {
      200: { description: 'Every item, newest first.', content: { 'application/json': { schema: z.array(uiContentItemSchema) } } },
      404: { description: 'No UI content type with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { typeId } = c.req.valid('param');
    const db = getDb(c);
    if (!(await getUiContentTypeById(db, typeId))) return c.json({ error: 'UI content type not found' }, 404);
    return c.json((await listUiContentItems(db, typeId)).map(toUiContentItem), 200);
  },
);

uiContentRoute.openapi(
  createRoute({
    method: 'post',
    path: '/types/{typeId}/items',
    tags: ['UI Content'],
    summary: 'Create a UI content item',
    middleware: requireRole('admin', 'editor'),
    request: {
      params: z.object({ typeId: z.string().min(1) }),
      body: { content: { 'application/json': { schema: createUiContentItemSchema } } },
    },
    responses: {
      201: { description: 'The created item.', content: { 'application/json': { schema: uiContentItemSchema } } },
      400: {
        description: "The data doesn't match the type's field definitions, or the slug is already used within this type.",
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: { description: 'No UI content type with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { typeId } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = getDb(c);

    const type = await getUiContentTypeById(db, typeId);
    if (!type) return c.json({ error: 'UI content type not found' }, 404);
    if (await getUiContentItemBySlug(db, typeId, input.slug)) {
      return c.json({ error: 'An item with that slug already exists for this type' }, 400);
    }

    const validated = validateUiContentData(type.fields, input.data);
    if (validated.issues) {
      return c.json({ error: 'Validation failed', issues: validated.issues }, 400);
    }

    const created = await createUiContentItem(db, {
      uiContentTypeId: typeId,
      slug: input.slug,
      data: validated.data!,
      enabled: input.enabled ?? true,
    });
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'ui_content_item.created',
      targetType: 'ui_content_item',
      targetId: created.id,
      metadata: { uiContentTypeId: typeId, slug: created.slug },
    });
    await invalidatePublicUiContentCache(type.slug, created.slug);
    return c.json(toUiContentItem(created), 201);
  },
);

uiContentRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/types/{typeId}/items/{itemId}',
    tags: ['UI Content'],
    summary: 'Update a UI content item',
    middleware: requireRole('admin', 'editor'),
    request: { params: typeItemParamSchema, body: { content: { 'application/json': { schema: updateUiContentItemSchema } } } },
    responses: {
      200: { description: 'The updated item.', content: { 'application/json': { schema: uiContentItemSchema } } },
      400: {
        description: "The data doesn't match the type's field definitions, or the slug is already used within this type.",
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: { description: 'No matching type/item.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { typeId, itemId } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = getDb(c);

    const type = await getUiContentTypeById(db, typeId);
    if (!type) return c.json({ error: 'UI content type not found' }, 404);
    const existing = await getUiContentItemById(db, itemId);
    if (!existing || existing.uiContentTypeId !== typeId) return c.json({ error: 'Item not found' }, 404);

    if (input.slug && input.slug !== existing.slug) {
      const bySlug = await getUiContentItemBySlug(db, typeId, input.slug);
      if (bySlug) return c.json({ error: 'An item with that slug already exists for this type' }, 400);
    }

    let data: Record<string, unknown> | undefined;
    if (input.data !== undefined) {
      const validated = validateUiContentData(type.fields, input.data);
      if (validated.issues) {
        return c.json({ error: 'Validation failed', issues: validated.issues }, 400);
      }
      data = validated.data;
    }

    const updated = await updateUiContentItem(db, itemId, {
      slug: input.slug,
      data,
      enabled: input.enabled,
    });
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'ui_content_item.updated',
      targetType: 'ui_content_item',
      targetId: itemId,
      metadata: { uiContentTypeId: typeId },
    });
    await invalidatePublicUiContentCache(type.slug, existing.slug);
    if (updated!.slug !== existing.slug) await invalidatePublicUiContentCache(type.slug, updated!.slug);
    return c.json(toUiContentItem(updated!), 200);
  },
);

uiContentRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/types/{typeId}/items/{itemId}',
    tags: ['UI Content'],
    summary: 'Delete a UI content item',
    middleware: requireRole('admin', 'editor'),
    request: { params: typeItemParamSchema },
    responses: {
      204: { description: 'The item was deleted.' },
      404: { description: 'No matching type/item.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { typeId, itemId } = c.req.valid('param');
    const db = getDb(c);
    const type = await getUiContentTypeById(db, typeId);
    if (!type) return c.json({ error: 'UI content type not found' }, 404);
    const existing = await getUiContentItemById(db, itemId);
    if (!existing || existing.uiContentTypeId !== typeId) return c.json({ error: 'Item not found' }, 404);

    await deleteUiContentItem(db, itemId);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'ui_content_item.deleted',
      targetType: 'ui_content_item',
      targetId: itemId,
      metadata: { uiContentTypeId: typeId, slug: existing.slug },
    });
    await invalidatePublicUiContentCache(type.slug, existing.slug);
    return c.body(null, 204);
  },
);
