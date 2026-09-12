import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

import type { BlockType } from '@kenresoft-cms/contracts';

export type { BlockType };

// Phase 4 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.4): a single reusable
// block, e.g. "Global CTA" — referenced from a Page's own block tree via a
// `{type: "reusableBlockRef", config: {reusableBlockId}}` node, never copied. Decision: **a
// live reference, not a snapshot** — editing this row updates every page embedding it
// immediately, at the cost of a conservative full-Pages-cache purge on every write
// (`invalidateAllPageCaches`, routes/admin/reusable-blocks.ts) rather than tracking per-page
// usage — accepted since reusable blocks change far less often than page content (§8/§16).
export const reusableBlocks = sqliteTable('reusable_blocks', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  // One BlockInstance type, validated with the exact same per-type config schema a Page's own
  // block tree uses (packages/contracts/schemas/blocks.ts) — restricted at the API layer to
  // leaf types only (never "columns", which has nowhere to store children in this table, and
  // never "reusableBlockRef" itself, which would allow a reference chain).
  type: text('type').notNull().$type<BlockType>(),
  config: text('config', { mode: 'json' })
    .notNull()
    .$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ReusableBlock = typeof reusableBlocks.$inferSelect;
export type NewReusableBlock = typeof reusableBlocks.$inferInsert;
