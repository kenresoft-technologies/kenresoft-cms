import { createRoute } from '@hono/zod-openapi';
import {
  createTemplateSchema,
  idParamSchema,
  templateSchema,
  updateTemplateSchema,
  validateBlockTree,
} from '@kenresoft-cms/contracts';
import type { BlockInstance, Template } from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import {
  createTemplate,
  deleteTemplate,
  getTemplateById,
  listTemplates,
  updateTemplate,
} from '../../repositories/templates';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { Template as DbTemplate } from '@kenresoft-cms/database';

export const templatesRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });

// Structural writes, same admin/editor floor as Pages (§4.1) — a template shapes every page
// created from it going forward.
const requireTemplateWriteRole = requireRole('admin', 'editor');

function toTemplate(row: DbTemplate): Template {
  return {
    id: row.id,
    name: row.name,
    contentTypeId: row.contentTypeId,
    blocks: row.blocks.blocks,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

templatesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Templates'],
    summary: 'List every template',
    responses: {
      200: {
        description: 'Every template.',
        content: { 'application/json': { schema: z.array(templateSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    return c.json((await listTemplates(db)).map(toTemplate), 200);
  },
);

templatesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Templates'],
    summary: 'Create a template',
    middleware: requireTemplateWriteRole,
    request: { body: { content: { 'application/json': { schema: createTemplateSchema } } } },
    responses: {
      201: { description: 'The created template.', content: { 'application/json': { schema: templateSchema } } },
      400: {
        description: 'A block in the tree is invalid.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);

    const blockError = validateBlockTree(input.blocks as BlockInstance[]);
    if (blockError) return c.json({ error: blockError }, 400);

    const template = await createTemplate(db, {
      name: input.name,
      contentTypeId: input.contentTypeId ?? null,
      blocks: { blocks: input.blocks },
      isDefault: input.isDefault,
    });
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'template.created',
      targetType: 'template',
      targetId: template.id,
      metadata: { name: template.name },
    });
    return c.json(toTemplate(template), 201);
  },
);

templatesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Templates'],
    summary: 'Get a template by id',
    request: { params: idParamSchema },
    responses: {
      200: { description: 'The template.', content: { 'application/json': { schema: templateSchema } } },
      404: { description: 'No template with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const template = await getTemplateById(db, id);
    if (!template) return c.json({ error: 'Template not found' }, 404);
    return c.json(toTemplate(template), 200);
  },
);

templatesRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Templates'],
    summary: 'Update a template',
    middleware: requireTemplateWriteRole,
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateTemplateSchema } } },
    },
    responses: {
      200: { description: 'The updated template.', content: { 'application/json': { schema: templateSchema } } },
      400: {
        description: 'A block in the tree is invalid.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: { description: 'No template with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getTemplateById(db, id);
    if (!existing) return c.json({ error: 'Template not found' }, 404);

    const input = c.req.valid('json');
    if (input.blocks) {
      const blockError = validateBlockTree(input.blocks as BlockInstance[]);
      if (blockError) return c.json({ error: blockError }, 400);
    }

    const template = await updateTemplate(db, id, {
      name: input.name,
      contentTypeId: 'contentTypeId' in input ? (input.contentTypeId ?? null) : undefined,
      blocks: input.blocks ? { blocks: input.blocks } : undefined,
      isDefault: input.isDefault,
    });
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'template.updated',
      targetType: 'template',
      targetId: id,
      metadata: { name: template!.name },
    });
    return c.json(toTemplate(template!), 200);
  },
);

templatesRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Templates'],
    summary: 'Delete a template',
    middleware: requireTemplateWriteRole,
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The template was deleted.' },
      404: { description: 'No template with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getTemplateById(db, id);
    if (!existing) return c.json({ error: 'Template not found' }, 404);

    await deleteTemplate(db, id);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'template.deleted',
      targetType: 'template',
      targetId: id,
      metadata: { name: existing.name },
    });
    return c.body(null, 204);
  },
);
