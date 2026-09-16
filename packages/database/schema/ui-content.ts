import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import type { FieldType } from '@kenresoft-cms/contracts';

// UI Content sits between Entries (editorial, structural, content-type-modeled) and Reusable
// Blocks (global, embedded live inside a Page's own block tree) — a small first-class model for
// independently-managed, structured UI objects (Hero, Carousel, Promo Banner, Feature Grid,
// Testimonials, …) that aren't full editorial content and aren't a shared block reference
// either. Deliberately its own pair of tables, never a row in `content_types`/`entries` (which
// would surface these in the Content Types/Entries admin UI and the generic
// GET /api/v1/public/:contentType route, mixing "site widgets" into "editorial content") and
// never a `reusable_blocks` row (which is a live-reference-only, no-schema JSON config, not a
// typed, independently fetchable object with its own slug/identity).
//
// A UI content TYPE defines its own field shape inline as JSON (`fields`), the same
// `name/label/fieldType/required/config` shape field-definitions.ts already uses for Content
// Types — reusing that exact field-type vocabulary (FIELD_TYPES) rather than inventing a
// second one. Kept as a JSON column on the type row itself, not a normalized child table like
// content-types' own `field_definitions` — a UI content type is expected to be small and
// static (a handful of fields defined once when the type is created), with none of Content
// Types' drag-reorder/rename-tracking/per-field-history needs, so a normalized table here would
// be unused structure, not a real requirement.
export const uiContentTypes = sqliteTable(
  'ui_content_types',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    fields: text('fields', { mode: 'json' })
      .notNull()
      .$type<{ name: string; label: string; fieldType: FieldType; required: boolean; config: Record<string, unknown> }[]>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex('ui_content_types_slug_idx').on(table.slug)],
);

// A UI content ITEM: one instance of a UI content type, addressed by (type, slug) — e.g. type
// "hero", slug "home-page-hero". `data` is validated server-side against its type's own
// `fields` (apps/api/src/lib/ui-content-validation.ts), the same
// build-a-schema-from-field-definitions approach forms' own submission validation already uses.
// `enabled` lets an admin hide an item from the public API without deleting it (no separate
// draft/publish workflow — that's Entries' job; this is a much lighter-weight model on
// purpose).
export const uiContentItems = sqliteTable(
  'ui_content_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    uiContentTypeId: text('ui_content_type_id')
      .notNull()
      .references(() => uiContentTypes.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    data: text('data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('ui_content_items_type_slug_idx').on(table.uiContentTypeId, table.slug),
    index('ui_content_items_type_id_idx').on(table.uiContentTypeId),
  ],
);

export type UiContentType = typeof uiContentTypes.$inferSelect;
export type NewUiContentType = typeof uiContentTypes.$inferInsert;
export type UiContentItem = typeof uiContentItems.$inferSelect;
export type NewUiContentItem = typeof uiContentItems.$inferInsert;
