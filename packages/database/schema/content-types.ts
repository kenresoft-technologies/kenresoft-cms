import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const contentTypes = sqliteTable(
  'content_types',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    // Phase 2 of the schema-driven frontend work (docs/SITE_BUILDER.md) — e.g. "/blog/{slug}".
    // Null (every content type before this feature, and any created without one) means this
    // content type has no frontend route of its own; validated at the API layer (shape,
    // reserved-path, and uniqueness), not constrained beyond the unique index at the DB layer.
    routePattern: text('route_pattern'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    // A unique index over a nullable SQLite column allows any number of NULLs (content types
    // with no route of their own) while still enforcing uniqueness among the ones that do —
    // exactly the "no duplicate/conflicting route patterns" requirement, enforced at the DB
    // layer as defense-in-depth alongside the API's own pre-write collision check.
    uniqueIndex('content_types_route_pattern_unique').on(table.routePattern),
  ],
);

export type ContentType = typeof contentTypes.$inferSelect;
export type NewContentType = typeof contentTypes.$inferInsert;
