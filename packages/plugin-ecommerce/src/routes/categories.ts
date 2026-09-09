import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp, requirePluginRole } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginVariables } from '@kenresoft-cms/plugin-sdk';
import type { PluginCommerceCategory } from '@kenresoft-cms/database';

import { createCategory, deleteCategory, getCategoryById, listCategories, updateCategory } from '../repository/categories';

export const categoriesRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });

const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  parentId: z.string().nullable(),
  imageId: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createCategorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  imageId: z.string().nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
  sortOrder: z.number().int().optional(),
});

const updateCategorySchema = createCategorySchema.partial();

function toCategory(row: PluginCommerceCategory): z.infer<typeof categorySchema> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parentId: row.parentId,
    imageId: row.imageId,
    status: row.status,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

categoriesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Commerce Categories'],
    summary: 'List every category',
    responses: {
      200: {
        description: 'Every category, ordered by sortOrder.',
        content: { 'application/json': { schema: z.array(categorySchema) } },
      },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    return c.json((await listCategories(ctx.db)).map(toCategory), 200);
  },
);

categoriesRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Commerce Categories'],
    summary: 'Create a category (editor and above)',
    middleware: requirePluginRole('editor'),
    request: { body: { content: { 'application/json': { schema: createCategorySchema } } } },
    responses: {
      201: { description: 'The created category.', content: { 'application/json': { schema: categorySchema } } },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');
    const row = await createCategory(ctx.db, {
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      parentId: input.parentId ?? null,
      imageId: input.imageId ?? null,
      status: input.status ?? 'active',
      sortOrder: input.sortOrder ?? 0,
    });
    return c.json(toCategory(row), 201);
  },
);

categoriesRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Commerce Categories'],
    summary: 'Update a category (editor and above)',
    middleware: requirePluginRole('editor'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateCategorySchema } } },
    },
    responses: {
      200: { description: 'The updated category.', content: { 'application/json': { schema: categorySchema } } },
      404: { description: 'No category with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');

    const existing = await getCategoryById(ctx.db, id);
    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    const row = await updateCategory(ctx.db, id, input);
    return c.json(toCategory(row!), 200);
  },
);

categoriesRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Commerce Categories'],
    summary: 'Delete a category (editor and above)',
    middleware: requirePluginRole('editor'),
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The category was deleted.' },
      404: { description: 'No category with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const ctx = c.get('pluginContext');

    const existing = await getCategoryById(ctx.db, id);
    if (!existing) {
      return c.json({ error: 'Category not found' }, 404);
    }

    await deleteCategory(ctx.db, id);
    return c.body(null, 204);
  },
);
