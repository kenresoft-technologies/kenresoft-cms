import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

import { contentTypes } from './content-types';
import { user } from './auth';
// ENTRY_STATUSES itself lives in packages/contracts — see field-definitions.ts for why.
import type { EntryStatus } from '@kenresoft-cms/contracts';

export type { EntryStatus };

export const entries = sqliteTable(
  'entries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    contentTypeId: text('content_type_id')
      .notNull()
      .references(() => contentTypes.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    status: text('status').notNull().$type<EntryStatus>().default('draft'),
    // Nullable — set while still Draft to queue a Cron Trigger transition to Published once
    // it elapses (§13). Null means "no schedule," not "publish immediately."
    publishAt: integer('publish_at', { mode: 'timestamp' }),
    // Nullable: the account that created this entry, when there was one — mirrors
    // entry_revisions.createdBy (a future system-triggered creation may not have one). Set
    // once at creation and never changed by later edits, unlike entry_revisions.createdBy
    // which records the author of every individual save.
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    // Field values keyed by FieldDefinition.name — validated against the content type's
    // field definitions at the API layer, not the DB layer.
    data: text('data', { mode: 'json' })
      .notNull()
      .$type<Record<string, unknown>>(),
    // Millisecond precision (matching entry_revisions.createdAt) — plain unixepoch() only
    // resolves to the second, which made "recent activity" ordering (dashboard, §20 Phase
    // beyond) non-deterministic for entries created or updated within the same second.
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex('entries_content_type_slug_unique').on(table.contentTypeId, table.slug),
    // Scanned by the scheduled-publishing Cron Trigger (§13): status = 'draft' AND
    // publishAt <= now().
    index('entries_status_publish_at_idx').on(table.status, table.publishAt),
  ],
);

export type Entry = typeof entries.$inferSelect;
export type NewEntry = typeof entries.$inferInsert;
