import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicVariables } from '@kenresoft-cms/plugin-sdk';
import type { PluginCommerceCategory, PluginCommerceProduct, PluginCommerceProductImage, PluginCommerceProductVariant } from '@kenresoft-cms/database';

import { listCategories } from '../repository/categories';
import { listImagesForProduct } from '../repository/images';
import { getPublishedProductBySlug, listProducts } from '../repository/products';
import { listVariantsForProduct } from '../repository/variants';

// Unauthenticated, storefront-facing catalog reads — mounted at the root of the full public
// mount (src/index.ts composes this alongside customer-auth/customer/cart). Deliberately its own,
// separate schema shapes from the admin routes: no internal metadata/timestamps, and a published
// product 404s exactly like a nonexistent slug — the same security convention Core's own public
// content API already uses.
export const catalogPublicRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();

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

const publicProductImageSchema = z.object({
  id: z.string(),
  mediaId: z.string(),
  altText: z.string().nullable(),
  sortOrder: z.number(),
});

const publicProductVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
  // Null = use the parent product's own basePrice — the same convention the admin API and
  // cart's own serializeCart() already use, so a storefront's price-resolution logic (product
  // basePrice unless a selected variant overrides it) stays identical on both surfaces.
  price: z.number().nullable(),
  compareAtPrice: z.number().nullable(),
  stockQty: z.number(),
  attributes: z.record(z.string(), z.string()).nullable(),
});

// Detail only (not the list route) — a storefront needs a product's own images/variants to
// render it at all (a photo, a size/color picker), but the list/grid view doesn't, and fetching
// every product's images/variants there would mean an extra query per row for a view that's
// already reachable one click away from the detail page that has them. Archived variants are
// filtered out here the same way cart.ts's own add-to-item check already treats them — never
// orderable, so never worth showing as a choice on the storefront either.
const publicProductDetailSchema = publicProductSchema.extend({
  images: z.array(publicProductImageSchema),
  variants: z.array(publicProductVariantSchema),
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

function toPublicProductImage(row: PluginCommerceProductImage): z.infer<typeof publicProductImageSchema> {
  return { id: row.id, mediaId: row.mediaId, altText: row.altText, sortOrder: row.sortOrder };
}

function toPublicProductVariant(row: PluginCommerceProductVariant): z.infer<typeof publicProductVariantSchema> {
  return { id: row.id, name: row.name, sku: row.sku, price: row.price, compareAtPrice: row.compareAtPrice, stockQty: row.stockQty, attributes: row.attributes };
}

catalogPublicRoutes.openapi(
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

catalogPublicRoutes.openapi(
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

catalogPublicRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/products/{slug}',
    tags: ['Commerce (public)'],
    summary: 'Get one published product by slug, with its images and active variants',
    request: { params: z.object({ slug: z.string().min(1) }) },
    responses: {
      200: { description: 'The published product.', content: { 'application/json': { schema: publicProductDetailSchema } } },
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
    const [images, variants] = await Promise.all([listImagesForProduct(ctx.db, row.id), listVariantsForProduct(ctx.db, row.id)]);
    return c.json(
      {
        ...toPublicProduct(row),
        images: images.map(toPublicProductImage),
        variants: variants.filter((variant) => variant.status === 'active').map(toPublicProductVariant),
      },
      200,
    );
  },
);
