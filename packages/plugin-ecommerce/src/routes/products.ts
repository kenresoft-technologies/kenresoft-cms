import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp, requirePluginRole } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginVariables } from '@kenresoft-cms/plugin-sdk';
import type { PluginCommerceProduct, PluginCommerceProductImage, PluginCommerceProductVariant } from '@kenresoft-cms/database';

import { getCategoryById } from '../repository/categories';
import { createProductImage, deleteProductImage, getImageById, listImagesForProduct } from '../repository/images';
import { createProduct, deleteProduct, getProductById, listProducts, updateProduct } from '../repository/products';
import { createVariant, deleteVariant, getVariantById, listVariantsForProduct, updateVariant } from '../repository/variants';

export const productsRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });
const productVariantParamSchema = z.object({ id: z.string().min(1), variantId: z.string().min(1) });
const productImageParamSchema = z.object({ id: z.string().min(1), imageId: z.string().min(1) });

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  shortDescription: z.string().nullable(),
  status: z.enum(['draft', 'published']),
  productType: z.enum(['physical', 'digital', 'service']),
  basePrice: z.number(),
  currency: z.string(),
  sku: z.string().nullable(),
  categoryId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createProductSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable().optional(),
  shortDescription: z.string().nullable().optional(),
  status: z.enum(['draft', 'published']).optional(),
  productType: z.enum(['physical', 'digital', 'service']).optional(),
  basePrice: z.number().int().nonnegative(),
  currency: z.string().length(3),
  sku: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const updateProductSchema = createProductSchema.partial();

const variantSchema = z.object({
  id: z.string(),
  productId: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
  price: z.number().nullable(),
  compareAtPrice: z.number().nullable(),
  stockQty: z.number(),
  status: z.enum(['active', 'archived']),
  attributes: z.record(z.string(), z.string()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createVariantSchema = z.object({
  name: z.string().min(1),
  sku: z.string().nullable().optional(),
  price: z.number().int().nonnegative().nullable().optional(),
  compareAtPrice: z.number().int().nonnegative().nullable().optional(),
  stockQty: z.number().int().nonnegative().optional(),
  status: z.enum(['active', 'archived']).optional(),
  attributes: z.record(z.string(), z.string()).nullable().optional(),
});

const updateVariantSchema = createVariantSchema.partial();

const imageSchema = z.object({
  id: z.string(),
  productId: z.string(),
  mediaId: z.string(),
  sortOrder: z.number(),
  altText: z.string().nullable(),
  createdAt: z.string(),
});

const createImageSchema = z.object({
  mediaId: z.string().min(1),
  sortOrder: z.number().int().optional(),
  altText: z.string().nullable().optional(),
});

const productDetailSchema = productSchema.extend({
  variants: z.array(variantSchema),
  images: z.array(imageSchema),
});

function toProduct(row: PluginCommerceProduct): z.infer<typeof productSchema> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    shortDescription: row.shortDescription,
    status: row.status,
    productType: row.productType,
    basePrice: row.basePrice,
    currency: row.currency,
    sku: row.sku,
    categoryId: row.categoryId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toVariant(row: PluginCommerceProductVariant): z.infer<typeof variantSchema> {
  return {
    id: row.id,
    productId: row.productId,
    name: row.name,
    sku: row.sku,
    price: row.price,
    compareAtPrice: row.compareAtPrice,
    stockQty: row.stockQty,
    status: row.status,
    attributes: row.attributes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toImage(row: PluginCommerceProductImage): z.infer<typeof imageSchema> {
  return {
    id: row.id,
    productId: row.productId,
    mediaId: row.mediaId,
    sortOrder: row.sortOrder,
    altText: row.altText,
    createdAt: row.createdAt.toISOString(),
  };
}

productsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Commerce Products'],
    summary: 'List products, optionally filtered by status/category',
    request: {
      query: z.object({
        status: z.enum(['draft', 'published']).optional(),
        categoryId: z.string().optional(),
      }),
    },
    responses: {
      200: { description: 'Every matching product.', content: { 'application/json': { schema: z.array(productSchema) } } },
    },
  }),
  async (c) => {
    const { status, categoryId } = c.req.valid('query');
    const ctx = c.get('pluginContext');
    const rows = await listProducts(ctx.db, { status, categoryId });
    return c.json(rows.map(toProduct), 200);
  },
);

productsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Commerce Products'],
    summary: 'Create a product (editor and above)',
    middleware: requirePluginRole('editor'),
    request: { body: { content: { 'application/json': { schema: createProductSchema } } } },
    responses: {
      201: { description: 'The created product.', content: { 'application/json': { schema: productSchema } } },
      400: {
        description: 'categoryId does not reference a real category.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');

    if (input.categoryId && !(await getCategoryById(ctx.db, input.categoryId))) {
      return c.json({ error: 'No category with that id' }, 400);
    }

    const row = await createProduct(ctx.db, {
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      shortDescription: input.shortDescription ?? null,
      status: input.status ?? 'draft',
      productType: input.productType ?? 'physical',
      basePrice: input.basePrice,
      currency: input.currency,
      sku: input.sku ?? null,
      categoryId: input.categoryId ?? null,
      metadata: input.metadata ?? null,
    });
    return c.json(toProduct(row), 201);
  },
);

productsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Commerce Products'],
    summary: 'Get a product with its variants and images',
    request: { params: idParamSchema },
    responses: {
      200: { description: 'The product, its variants, and its images.', content: { 'application/json': { schema: productDetailSchema } } },
      404: { description: 'No product with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const ctx = c.get('pluginContext');

    const row = await getProductById(ctx.db, id);
    if (!row) {
      return c.json({ error: 'Product not found' }, 404);
    }

    const [variants, images] = await Promise.all([listVariantsForProduct(ctx.db, id), listImagesForProduct(ctx.db, id)]);
    return c.json({ ...toProduct(row), variants: variants.map(toVariant), images: images.map(toImage) }, 200);
  },
);

productsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Commerce Products'],
    summary: 'Update a product (editor and above)',
    middleware: requirePluginRole('editor'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateProductSchema } } },
    },
    responses: {
      200: { description: 'The updated product.', content: { 'application/json': { schema: productSchema } } },
      400: {
        description: 'categoryId does not reference a real category.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: { description: 'No product with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');

    const existing = await getProductById(ctx.db, id);
    if (!existing) {
      return c.json({ error: 'Product not found' }, 404);
    }
    if (input.categoryId && !(await getCategoryById(ctx.db, input.categoryId))) {
      return c.json({ error: 'No category with that id' }, 400);
    }

    const row = await updateProduct(ctx.db, id, input);
    return c.json(toProduct(row!), 200);
  },
);

productsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Commerce Products'],
    summary: 'Delete a product (editor and above)',
    middleware: requirePluginRole('editor'),
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The product (and its variants/images) was deleted.' },
      404: { description: 'No product with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const ctx = c.get('pluginContext');

    const existing = await getProductById(ctx.db, id);
    if (!existing) {
      return c.json({ error: 'Product not found' }, 404);
    }

    await deleteProduct(ctx.db, id);
    return c.body(null, 204);
  },
);

productsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/variants',
    tags: ['Commerce Products'],
    summary: 'Add a variant to a product (editor and above)',
    middleware: requirePluginRole('editor'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: createVariantSchema } } },
    },
    responses: {
      201: { description: 'The created variant.', content: { 'application/json': { schema: variantSchema } } },
      404: { description: 'No product with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');

    if (!(await getProductById(ctx.db, id))) {
      return c.json({ error: 'Product not found' }, 404);
    }

    const row = await createVariant(ctx.db, {
      productId: id,
      name: input.name,
      sku: input.sku ?? null,
      price: input.price ?? null,
      compareAtPrice: input.compareAtPrice ?? null,
      stockQty: input.stockQty ?? 0,
      status: input.status ?? 'active',
      attributes: input.attributes ?? null,
    });
    return c.json(toVariant(row), 201);
  },
);

productsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/variants/{variantId}',
    tags: ['Commerce Products'],
    summary: 'Update a variant (editor and above)',
    middleware: requirePluginRole('editor'),
    request: {
      params: productVariantParamSchema,
      body: { content: { 'application/json': { schema: updateVariantSchema } } },
    },
    responses: {
      200: { description: 'The updated variant.', content: { 'application/json': { schema: variantSchema } } },
      404: {
        description: 'No variant with that id belonging to that product.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, variantId } = c.req.valid('param');
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');

    // Same "404s editing a row that belongs to a different parent" precedent as Core's
    // content-type field editing — a variantId that exists but under a different productId
    // must not be editable through this URL.
    const existing = await getVariantById(ctx.db, variantId);
    if (!existing || existing.productId !== id) {
      return c.json({ error: 'Variant not found' }, 404);
    }

    const row = await updateVariant(ctx.db, variantId, input);
    return c.json(toVariant(row!), 200);
  },
);

productsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/variants/{variantId}',
    tags: ['Commerce Products'],
    summary: 'Delete a variant (editor and above)',
    middleware: requirePluginRole('editor'),
    request: { params: productVariantParamSchema },
    responses: {
      204: { description: 'The variant was deleted.' },
      404: {
        description: 'No variant with that id belonging to that product.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, variantId } = c.req.valid('param');
    const ctx = c.get('pluginContext');

    const existing = await getVariantById(ctx.db, variantId);
    if (!existing || existing.productId !== id) {
      return c.json({ error: 'Variant not found' }, 404);
    }

    await deleteVariant(ctx.db, variantId);
    return c.body(null, 204);
  },
);

productsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/images',
    tags: ['Commerce Products'],
    summary: 'Associate an existing media item with a product (editor and above)',
    middleware: requirePluginRole('editor'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: createImageSchema } } },
    },
    responses: {
      201: { description: 'The created image association.', content: { 'application/json': { schema: imageSchema } } },
      400: { description: 'mediaId does not reference a real media item.', content: { 'application/json': { schema: notFoundSchema } } },
      404: { description: 'No product with that id.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');

    if (!(await getProductById(ctx.db, id))) {
      return c.json({ error: 'Product not found' }, 404);
    }
    // Never uploads directly — only ever associates an existing Core media row, reached
    // through the SDK's media service rather than the media table directly.
    if (!(await ctx.media.get(input.mediaId))) {
      return c.json({ error: 'No media item with that id' }, 400);
    }

    const row = await createProductImage(ctx.db, {
      productId: id,
      mediaId: input.mediaId,
      sortOrder: input.sortOrder ?? 0,
      altText: input.altText ?? null,
    });
    return c.json(toImage(row), 201);
  },
);

productsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/images/{imageId}',
    tags: ['Commerce Products'],
    summary: 'Remove an image association from a product (editor and above)',
    middleware: requirePluginRole('editor'),
    request: { params: productImageParamSchema },
    responses: {
      204: { description: 'The image association was removed.' },
      404: {
        description: 'No image with that id belonging to that product.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, imageId } = c.req.valid('param');
    const ctx = c.get('pluginContext');

    const existing = await getImageById(ctx.db, imageId);
    if (!existing || existing.productId !== id) {
      return c.json({ error: 'Image not found' }, 404);
    }

    await deleteProductImage(ctx.db, imageId);
    return c.body(null, 204);
  },
);
