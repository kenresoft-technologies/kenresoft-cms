import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { contentTypes } from './content-types';

// Real hierarchical folders for organizing Entry instances — scoped per content type (a folder
// only ever holds entries of the one content type it belongs to, since entries themselves are
// always scoped to one content type). Deliberately NOT part of the content-type schema itself
// (field-definitions.ts) — folders organize instances, never the type's shape. Nested via a
// self-referencing parentId, mirroring plugin-commerce's own category hierarchy
// (packages/database/schema/plugins/commerce.ts) — same `AnySQLiteColumn` return-type
// annotation on the `.references()` callback, required to avoid a circular type reference that
// otherwise collapses the table's inferred type to `any`.
export const entryFolders = sqliteTable(
  'entry_folders',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    contentTypeId: text('content_type_id')
      .notNull()
      .references(() => contentTypes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Self-FK for nesting — set-null on delete so removing a parent folder never cascades into
    // deleting its children, just reparents them to root (top-level within the content type),
    // matching plugin-commerce's own category precedent and this codebase's standing "deleting
    // a container never deletes what's inside it" convention.
    parentId: text('parent_id').references((): AnySQLiteColumn => entryFolders.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [
    index('entry_folders_content_type_id_idx').on(table.contentTypeId),
    index('entry_folders_parent_id_idx').on(table.parentId),
    // A folder name must be unique among its siblings (same content type, same parent — NULLS
    // are distinct in SQLite so this doesn't collapse every root-level folder into one slot).
    uniqueIndex('entry_folders_content_type_parent_name_idx').on(table.contentTypeId, table.parentId, table.name),
  ],
);

export type EntryFolder = typeof entryFolders.$inferSelect;
export type NewEntryFolder = typeof entryFolders.$inferInsert;
