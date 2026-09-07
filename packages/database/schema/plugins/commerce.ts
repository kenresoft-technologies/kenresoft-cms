import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
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

// Phase 2b: Cart & Customer. Deliberately separate from better-auth's own `user` table (auth.ts)
// — a storefront customer is a different actor on a different surface than CMS staff
// (owner/admin/editor/author/viewer), and this plugin depends only on `better-auth/crypto`'s
// standalone hashing primitives, never on better-auth's identity/session/instance (docs/
// PLUGINS.md's Commerce section has the full reasoning).
export const pluginCommerceCustomers = sqliteTable(
  'plugin_commerce_customers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Always stored lowercased/trimmed by the repository layer, not DB collation.
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    // Disabling revokes every session for this customer (plugin_commerce_customer_sessions),
    // mirroring the CMS's own user.disabled behavior.
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  // No separate plain index on email — the unique index above already serves lookups.
);

// A raw session token is only ever handed to the customer's browser (the session cookie) — only
// its SHA-256 hash is ever persisted, the same pattern this codebase already uses for recovery
// codes and CMS password-reset tokens (crypto.subtle.digest + constantTimeEqual).
export const pluginCommerceCustomerSessions = sqliteTable(
  'plugin_commerce_customer_sessions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    customerId: text('customer_id')
      .notNull()
      .references(() => pluginCommerceCustomers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    // Fixed 30-day TTL at creation — no sliding refresh-on-activity this pass.
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('plugin_commerce_customer_sessions_customer_id_idx').on(table.customerId)],
);

// Password-reset and email-verification tokens, hashed at rest the same way session tokens are.
// Single-use is enforced by deletion on consume (repository layer) — the same mechanism
// recovery-codes/password-reset already use in this codebase, not a separate usedAt column.
// Requesting a new token of the same purpose deletes any existing unconsumed one first.
export const pluginCommerceCustomerTokens = sqliteTable(
  'plugin_commerce_customer_tokens',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    customerId: text('customer_id')
      .notNull()
      .references(() => pluginCommerceCustomers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    purpose: text('purpose', { enum: ['password_reset', 'email_verification'] }).notNull(),
    // Password-reset: 1 hour, matching the CMS's own. Email-verification: 24 hours.
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('plugin_commerce_customer_tokens_customer_id_idx').on(table.customerId)],
);

export const pluginCommerceCustomerAddresses = sqliteTable(
  'plugin_commerce_customer_addresses',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    customerId: text('customer_id')
      .notNull()
      .references(() => pluginCommerceCustomers.id, { onDelete: 'cascade' }),
    label: text('label'),
    recipientName: text('recipient_name').notNull(),
    line1: text('line1').notNull(),
    line2: text('line2'),
    city: text('city').notNull(),
    region: text('region'),
    postalCode: text('postal_code').notNull(),
    country: text('country').notNull(),
    phone: text('phone'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('plugin_commerce_customer_addresses_customer_id_idx').on(table.customerId)],
);

// customerId NULL means a guest cart — identified purely by possessing its own id (an
// unguessable UUID) via the guest cart cookie, never promoted to customer identity except
// through the explicit, session-authenticated merge-on-login (repository/carts.ts). The partial
// unique index enforces "one active cart per customer" without constraining guest carts, which
// can be many (one per anonymous browser).
export const pluginCommerceCarts = sqliteTable(
  'plugin_commerce_carts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    customerId: text('customer_id').references(() => pluginCommerceCustomers.id, { onDelete: 'set null' }),
    // Defaults from the plugin's own config.defaultCurrency at creation; a cart stays
    // single-currency for the rest of its life even though a product's own currency can differ.
    currency: text('currency').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex('plugin_commerce_carts_customer_id_unique_idx')
      .on(table.customerId)
      .where(sql`${table.customerId} is not null`),
  ],
);

// Cascades on product/variant delete (matching the already-established variant/image
// cascade-on-product-delete precedent above) — a cart is ephemeral, pre-purchase state, not a
// durable record; silently dropping a deleted product's line item is the correct, low-risk
// behavior here. Contrast with the future Order (2c), which must snapshot product data
// independent of the live row, since an order is a durable financial/legal record. No price is
// ever stored on a cart item — price/name/stock are always read live from the product/variant;
// snapshotting belongs to Order. Dedup on (cartId, productId, variantId) is handled by the
// repository, not a DB unique constraint (SQLite doesn't collapse NULL variantId rows the way
// that needs), so only plain lookup indexes are declared here.
export const pluginCommerceCartItems = sqliteTable(
  'plugin_commerce_cart_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    cartId: text('cart_id')
      .notNull()
      .references(() => pluginCommerceCarts.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => pluginCommerceProducts.id, { onDelete: 'cascade' }),
    variantId: text('variant_id').references(() => pluginCommerceProductVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('plugin_commerce_cart_items_cart_id_idx').on(table.cartId),
    index('plugin_commerce_cart_items_product_id_idx').on(table.productId),
    index('plugin_commerce_cart_items_variant_id_idx').on(table.variantId),
  ],
);

export type PluginCommerceCategory = typeof pluginCommerceCategories.$inferSelect;
export type NewPluginCommerceCategory = typeof pluginCommerceCategories.$inferInsert;
export type PluginCommerceProduct = typeof pluginCommerceProducts.$inferSelect;
export type NewPluginCommerceProduct = typeof pluginCommerceProducts.$inferInsert;
export type PluginCommerceProductVariant = typeof pluginCommerceProductVariants.$inferSelect;
export type NewPluginCommerceProductVariant = typeof pluginCommerceProductVariants.$inferInsert;
export type PluginCommerceProductImage = typeof pluginCommerceProductImages.$inferSelect;
export type NewPluginCommerceProductImage = typeof pluginCommerceProductImages.$inferInsert;
export type PluginCommerceCustomer = typeof pluginCommerceCustomers.$inferSelect;
export type NewPluginCommerceCustomer = typeof pluginCommerceCustomers.$inferInsert;
export type PluginCommerceCustomerSession = typeof pluginCommerceCustomerSessions.$inferSelect;
export type NewPluginCommerceCustomerSession = typeof pluginCommerceCustomerSessions.$inferInsert;
export type PluginCommerceCustomerToken = typeof pluginCommerceCustomerTokens.$inferSelect;
export type NewPluginCommerceCustomerToken = typeof pluginCommerceCustomerTokens.$inferInsert;
export type PluginCommerceCustomerAddress = typeof pluginCommerceCustomerAddresses.$inferSelect;
export type NewPluginCommerceCustomerAddress = typeof pluginCommerceCustomerAddresses.$inferInsert;
export type PluginCommerceCart = typeof pluginCommerceCarts.$inferSelect;
export type NewPluginCommerceCart = typeof pluginCommerceCarts.$inferInsert;
export type PluginCommerceCartItem = typeof pluginCommerceCartItems.$inferSelect;
export type NewPluginCommerceCartItem = typeof pluginCommerceCartItems.$inferInsert;
