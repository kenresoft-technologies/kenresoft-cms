import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

import { entries, type EntryStatus } from './entries';
import { user } from './auth';

// A saved snapshot of an entry's state at some point in its history (§6, §13). Written
// before an entry is created/updated so there's always something to restore to — the
// current live row in `entries` is the latest state and is never itself a revision until
// superseded by the next edit.
export const entryRevisions = sqliteTable(
  'entry_revisions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    status: text('status').notNull().$type<EntryStatus>(),
    data: text('data', { mode: 'json' })
      .notNull()
      .$type<Record<string, unknown>>(),
    // Nullable: the account that made the change, when there was one — a future
    // system-triggered revision (e.g. the scheduled-publish Cron Trigger) may not have one.
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    // Millisecond precision (matching schema/auth.ts's generated columns) — plain
    // unixepoch() only has second resolution, which made ORDER BY created_at DESC
    // unpredictable for revisions written within the same second.
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [index('entry_revisions_entry_id_idx').on(table.entryId)],
);

export type EntryRevision = typeof entryRevisions.$inferSelect;
export type NewEntryRevision = typeof entryRevisions.$inferInsert;
