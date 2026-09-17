import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// A folder for organizing Media, file-manager style. Originally flat/non-nested by deliberate
// design (see git history) — extended here with a self-referencing `parentId` so the Media
// Library can offer real nested folders (Website → Home → Hero) per this pass's brief, mirroring
// entry-folders.ts's and plugin-commerce's own hierarchical-category precedent (same
// `AnySQLiteColumn` return-type annotation, needed for the same circular-type reason). `slug`
// stays globally unique (not just unique-among-siblings) since it's still what a frontend
// developer references explicitly (integrations/astro's `media.byFolder()`), and a public,
// slug-addressed API shouldn't have two different folders answering to the same slug regardless
// of nesting depth.
export const mediaFolders = sqliteTable(
  'media_folders',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // Null = a top-level folder. Set-null on delete — deleting a parent folder never deletes or
    // orphans its child folders' own contents, it just promotes the children to top-level.
    parentId: text('parent_id').references((): AnySQLiteColumn => mediaFolders.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('media_folders_slug_idx').on(table.slug),
    index('media_folders_parent_id_idx').on(table.parentId),
  ],
);

export type MediaFolder = typeof mediaFolders.$inferSelect;
export type NewMediaFolder = typeof mediaFolders.$inferInsert;
