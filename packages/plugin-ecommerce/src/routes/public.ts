import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';
import type { PluginCommerceCategory, PluginCommerceProduct } from '@kenresoft-cms/database';

import { listCategories } from '../repository/categories';
import { getPublishedProductBySlug, listProducts } from '../repository/products';

// Unauthenticated, storefront-facing (mounted at /api/plugins/commerce/public/v1/* via
// PluginRegistration.publicRoutes — the first plugin needing this platform extension,
// docs/PLUGINS.md). Deliberately its own, separate schema shapes from the admin routes: no
// internal metadata/timestamps, and a published product 404s exactly like a nonexistent slug —
// the same security convention Core's own public content API already uses.
export const publicCommerceRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();

const notFoundSchema = z.object({ error: z.string() });

const publicCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  parentId: z.string().nullable(),
});

const publicProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  shortDescription: z.string().nullable(),
  productType: z.enum(['physical', 'digital', 'service']),
  basePrice: z.number(),
  currency: z.string(),
  categoryId: z.string().nullable(),
});

function toPublicCategory(row: PluginCommerceCategory): z.infer<typeof publicCategorySchema> {
  return { id: row.id, name: row.name, slug: row.slug, description: row.description, parentId: row.parentId };
}

function toPublicProduct(row: PluginCommerceProduct): z.infer<typeof publicProductSchema> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    shortDescription: row.shortDescription,
    productType: row.productType,
    basePrice: row.basePrice,
    currency: row.currency,
    categoryId: row.categoryId,
  };
}

publicCommerceRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/categories',
    tags: ['Commerce (public)'],
    summary: 'List active categories',
    responses: {
      200: { description: 'Every active category.', content: { 'application/json': { schema: z.array(publicCategorySchema) } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const rows = await listCategories(ctx.db, { status: 'active' });
    return c.json(rows.map(toPublicCategory), 200);
  },
);

publicCommerceRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/products',
    tags: ['Commerce (public)'],
    summary: 'List published products, optionally filtered by category',
    request: { query: z.object({ categoryId: z.string().optional() }) },
    responses: {
      200: { description: 'Every published product.', content: { 'application/json': { schema: z.array(publicProductSchema) } } },
    },
  }),
  async (c) => {
    const { categoryId } = c.req.valid('query');
    const ctx = c.get('pluginContext');
    const rows = await listProducts(ctx.db, { status: 'published', categoryId });
    return c.json(rows.map(toPublicProduct), 200);
  },
);

publicCommerceRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/products/{slug}',
    tags: ['Commerce (public)'],
    summary: 'Get one published product by slug',
    request: { params: z.object({ slug: z.string().min(1) }) },
    responses: {
      200: { description: 'The published product.', content: { 'application/json': { schema: publicProductSchema } } },
      404: {
        description: 'No published product with that slug — indistinguishable from a nonexistent slug.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { slug } = c.req.valid('param');
    const ctx = c.get('pluginContext');
    const row = await getPublishedProductBySlug(ctx.db, slug);
    if (!row) {
      return c.json({ error: 'Product not found' }, 404);
    }
    return c.json(toPublicProduct(row), 200);
  },
);
