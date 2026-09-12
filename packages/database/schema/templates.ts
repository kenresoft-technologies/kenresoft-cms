import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

import { contentTypes } from './content-types';
import type { BlockInstance } from '@kenresoft-cms/contracts';

export type { BlockInstance };

// Phase 4 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.5): a default block
// composition, copied into a new Page (or, in a later phase, a content-type entry with no page
// of its own) at creation time — **never live-linked**, unlike reusable_blocks above. Editing a
// template only affects pages created from it afterward, not ones already created. Every
// template here is admin-editable data from day one — deliberately not a theme-provided-
// defaults-plus-overrides model (§3.5), since this architecture has no separate "theme" concept
// yet.
export const templates = sqliteTable('templates', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  // Null = a general-purpose page template; set = scoped to one content type (for a future
  // phase's "render this content type's entries through a template" use case, §5) — deleting
  // the content type sets this back to null rather than deleting the template itself, since a
  // template's blocks/name remain meaningful as a general-purpose template afterward.
  contentTypeId: text('content_type_id').references(() => contentTypes.id, { onDelete: 'set null' }),
  blocks: text('blocks', { mode: 'json' })
    .notNull()
    .$type<{ blocks: BlockInstance[] }>(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
