import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

import { projects } from './projects';
import { contentTypes } from './content-types';

export const ENTRY_STATUSES = ['draft', 'published'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const entries = sqliteTable(
  'entries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Denormalized alongside contentTypeId so project-scoped queries (§11 isolation) don't
    // require a join through content_types.
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    contentTypeId: text('content_type_id')
      .notNull()
      .references(() => contentTypes.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    status: text('status').notNull().$type<EntryStatus>().default('draft'),
    // Nullable — set while still Draft to queue a Cron Trigger transition to Published once
    // it elapses (§13). Null means "no schedule," not "publish immediately."
    publishAt: integer('publish_at', { mode: 'timestamp' }),
    // Field values keyed by FieldDefinition.name — validated against the content type's
    // field definitions at the API layer, not the DB layer.
    data: text('data', { mode: 'json' })
      .notNull()
      .$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex('entries_content_type_slug_unique').on(table.contentTypeId, table.slug),
    index('entries_project_status_idx').on(table.projectId, table.status),
    // Scanned by the scheduled-publishing Cron Trigger (§13): status = 'draft' AND
    // publishAt <= now().
    index('entries_status_publish_at_idx').on(table.status, table.publishAt),
  ],
);

export type Entry = typeof entries.$inferSelect;
export type NewEntry = typeof entries.$inferInsert;
