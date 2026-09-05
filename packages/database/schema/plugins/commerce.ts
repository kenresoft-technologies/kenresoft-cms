import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { media } from '../media';

// Owned by packages/plugin-ecommerce (docs/PLUGINS.md's migration-ownership convention) — lives
// here, not inside the plugin package itself, since drizzle-kit generate only reads this
// package's schema/index.ts. Ownership is enforced by the `plugin_commerce_` table-name prefix
// and by convention (only packages/plugin-ecommerce/src/repository/*.ts ever queries these
// tables), not a physically separate migration history or D1 database.

export const pluginCommerceCategories = sqliteTable(
  'plugin_commerce_categories',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    // Self-FK for hierarchical categories (spec §28) — set-null on delete so removing a parent
    // category never cascades into deleting its children, just orphans them to top-level.
    parentId: text('parent_id').references((): AnySQLiteColumn => pluginCommerceCategories.id, {
      onDelete: 'set null',
    }),
    // References Core's own media table directly (spec §29: reuse Core media, never manage raw
    // R2 objects independently) — set-null on delete since Core's media-delete route has no
    // FK-aware guard today; losing the cover image shouldn't block or corrupt a media delete.
    imageId: text('image_id').references(() => media.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('plugin_commerce_categories_slug_idx').on(table.slug),
    index('plugin_commerce_categories_parent_id_idx').on(table.parentId),
  ],
);

// Money as integer minor units + a currency code (spec §26: never floating point) — the first
// time this codebase has needed a monetary convention; established here, not borrowed from
// anywhere else since nothing else in this repo has modeled money before.
export const pluginCommerceProducts = sqliteTable(
  'plugin_commerce_products',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    shortDescription: text('short_description'),
    // Reuses entries' own draft/published vocabulary (packages/contracts' ENTRY_STATUSES)
    // rather than inventing new terms for the same concept.
    status: text('status', { enum: ['draft', 'published'] })
      .notNull()
      .default('draft'),
    // Not permanently physical-only (spec §26/§46) — digital/service products are a real,
    // if not-yet-implemented-beyond-the-column, future case.
    productType: text('product_type', { enum: ['physical', 'digital', 'service'] })
      .notNull()
      .default('physical'),
    basePrice: integer('base_price').notNull(),
    currency: text('currency').notNull(),
    sku: text('sku'),
    categoryId: text('category_id').references(() => pluginCommerceCategories.id, { onDelete: 'set null' }),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('plugin_commerce_products_slug_idx').on(table.slug),
    index('plugin_commerce_products_category_id_idx').on(table.categoryId),
    index('plugin_commerce_products_status_idx').on(table.status),
    index('plugin_commerce_products_sku_idx').on(table.sku),
  ],
);

// Deliberately flat — no separate "options" system (spec §27: "do not over-engineer an advanced
// product-option system"). `attributes` is a free-form JSON blob (e.g. {size:'S', color:'Black'})
// rather than a normalized option/value model.
export const pluginCommerceProductVariants = sqliteTable(
  'plugin_commerce_product_variants',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    productId: text('product_id')
      .notNull()
      .references(() => pluginCommerceProducts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sku: text('sku'),
    // Null = use the parent product's basePrice; set = overrides it for this variant.
    price: integer('price'),
    compareAtPrice: integer('compare_at_price'),
    stockQty: integer('stock_qty').notNull().default(0),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    attributes: text('attributes', { mode: 'json' }).$type<Record<string, string>>(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('plugin_commerce_product_variants_product_id_idx').on(table.productId),
    index('plugin_commerce_product_variants_sku_idx').on(table.sku),
  ],
);

// Associates an existing Core media row with a product (spec §29: Product Image -> Core Media
// -> R2) — cascades on media delete, since Core's media-delete route has no FK-aware guard
// today; a cascading delete here just drops the association, it never blocks or corrupts that
// existing route.
export const pluginCommerceProductImages = sqliteTable(
  'plugin_commerce_product_images',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    productId: text('product_id')
      .notNull()
      .references(() => pluginCommerceProducts.id, { onDelete: 'cascade' }),
    mediaId: text('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    // Overrides the media's own altText for this specific product context.
    altText: text('alt_text'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('plugin_commerce_product_images_product_id_idx').on(table.productId)],
);

export type PluginCommerceCategory = typeof pluginCommerceCategories.$inferSelect;
export type NewPluginCommerceCategory = typeof pluginCommerceCategories.$inferInsert;
export type PluginCommerceProduct = typeof pluginCommerceProducts.$inferSelect;
export type NewPluginCommerceProduct = typeof pluginCommerceProducts.$inferInsert;
export type PluginCommerceProductVariant = typeof pluginCommerceProductVariants.$inferSelect;
export type NewPluginCommerceProductVariant = typeof pluginCommerceProductVariants.$inferInsert;
export type PluginCommerceProductImage = typeof pluginCommerceProductImages.$inferSelect;
export type NewPluginCommerceProductImage = typeof pluginCommerceProductImages.$inferInsert;
