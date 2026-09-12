import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

import { pages, type BlockInstance, type EntryStatus, type PageSeo } from './pages';
import { user } from './auth';

// A saved snapshot of a Page's state at some point in its history (§3.2) — an exact structural
// mirror of entry_revisions, same write-before-every-change discipline, same restore semantics
// (repositories/pages.ts reuses repositories/entries.ts's revision code path as a template).
export const pageRevisions = sqliteTable(
  'page_revisions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: text('status').notNull().$type<EntryStatus>(),
    blocks: text('blocks', { mode: 'json' })
      .notNull()
      .$type<{ blocks: BlockInstance[] }>(),
    seo: text('seo', { mode: 'json' }).$type<PageSeo>(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [index('page_revisions_page_id_idx').on(table.pageId)],
);

export type PageRevision = typeof pageRevisions.$inferSelect;
export type NewPageRevision = typeof pageRevisions.$inferInsert;
