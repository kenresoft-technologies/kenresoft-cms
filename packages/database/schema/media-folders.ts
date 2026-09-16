import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

// A flat (non-nested) folder for organizing Media — deliberately no parentId/hierarchy: the
// brief asks for organizing a flat library into named collections (e.g. "home-page-hero"), not
// a general filesystem tree, and a flat set keeps both the admin UI and the public
// fetch-by-folder API (GET /api/v1/public/media?folder=<slug>) simple. `slug` is what a
// frontend developer references explicitly (integrations/astro's `media.byFolder()`), so it's
// unique and stable even if `name` is later renamed.
export const mediaFolders = sqliteTable(
  'media_folders',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex('media_folders_slug_idx').on(table.slug)],
);

export type MediaFolder = typeof mediaFolders.$inferSelect;
export type NewMediaFolder = typeof mediaFolders.$inferInsert;
