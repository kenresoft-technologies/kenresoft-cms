import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

import { user } from './auth';
// Type-only import, fully erased at build — mirrors field-definitions.ts's own reasoning for
// not importing runtime enum arrays from packages/contracts into a module that calls
// sqliteTable(...) at module scope.
import type { BlockInstance, EntryStatus, PageSeo } from '@kenresoft-cms/contracts';

export type { BlockInstance, EntryStatus, PageSeo };

// Phase 3 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.1). Deliberately no
// `templateId` column yet — Templates ship in Phase 4 (§13); adding that FK then is itself an
// additive nullable column, matching this project's own "additive only" migration convention
// (§10), not something this table needs to anticipate now.
export const pages = sqliteTable(
  'pages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // e.g. "/", "/about", "/services/design" — leading slash, no trailing slash except root;
    // validated at the API layer (pageRouteSchema) and checked there for collisions against
    // every content type's own routePattern (§4.3), not just uniqueness among Pages themselves.
    route: text('route').notNull(),
    title: text('title').notNull(),
    // Reuses ENTRY_STATUSES verbatim — same enum, not a new one (§3.1).
    status: text('status').notNull().$type<EntryStatus>().default('draft'),
    // Reuses the existing scheduled-publish sweep verbatim (§3.1/§13) — see
    // repositories/pages.ts's publishDuePages and index.ts's `scheduled` handler.
    publishAt: integer('publish_at', { mode: 'timestamp' }),
    // The page's own block composition tree — a JSON blob validated at the API layer against
    // each block type's own config schema (packages/contracts/schemas/blocks.ts), never at the
    // DB layer, exactly like entries.data (§3.3: blocks are never queried relationally, so a
    // normalized table would only add cost with no query it's needed for yet).
    blocks: text('blocks', { mode: 'json' })
      .notNull()
      .$type<{ blocks: BlockInstance[] }>(),
    // Nullable: a page-level override of the site-wide default (structured_settings' own `seo`
    // module) — null means "use the site default," matching every other nullable-metadata
    // column in this codebase (e.g. field_definitions.presentation).
    seo: text('seo', { mode: 'json' }).$type<PageSeo>(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  },
  (table) => [
    uniqueIndex('pages_route_unique').on(table.route),
    // Scanned by the same scheduled-publishing Cron Trigger that already scans
    // entries_status_publish_at_idx (§13).
    index('pages_status_publish_at_idx').on(table.status, table.publishAt),
  ],
);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
