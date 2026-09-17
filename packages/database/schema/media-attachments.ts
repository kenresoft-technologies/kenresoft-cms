import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { media } from './media';

// Phase 5 (docs/ARCHITECTURE.md's Media/Forms architecture review): a generic, domain-agnostic
// join between a Media asset and whatever owns/references it — a form submission's uploaded
// file today, potentially an entry/user/commerce resource/plugin resource later. Media itself
// never imports Forms/Entries/Users/Commerce to know about any of this; `ownerType`/`ownerId`
// are plain text, validated by each caller's own domain (e.g. 'form_submission'), not a closed
// DB-level enum — the same reasoning `structured_settings.module`'s own comment gives for why
// an enum-shaped column doesn't always need a DB CHECK constraint. This intentionally improves
// on the codebase's only prior polymorphic-reference precedent (`audit_log.targetType`/
// `targetId`), which has neither an index nor a uniqueness guard on the pair.
export const mediaAttachments = sqliteTable(
  'media_attachments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    mediaId: text('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    // Which field on the owner this attachment came from (e.g. a form's file-field name) — null
    // when the owner has no field-level distinction of its own.
    fieldName: text('field_name'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('media_attachments_owner_idx').on(table.ownerType, table.ownerId),
    uniqueIndex('media_attachments_media_owner_field_idx').on(
      table.mediaId,
      table.ownerType,
      table.ownerId,
      table.fieldName,
    ),
  ],
);

export type MediaAttachment = typeof mediaAttachments.$inferSelect;
export type NewMediaAttachment = typeof mediaAttachments.$inferInsert;
