import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Singleton per-deployment site configuration (§6, §11) — one deployment, one row. Enforced
// at the API layer once that surface is built (Phase 6), not by a DB constraint, matching how
// other cross-field invariants in this schema are handled (e.g. entries.data validated against
// field definitions at the API layer, not the DB layer).
export const settings = sqliteTable('settings', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  corsOrigin: text('cors_origin'),
  featureFlags: text('feature_flags', { mode: 'json' }).$type<Record<string, boolean>>(),
  // Live Preview's URL template for the public frontend, e.g. "https://mysite.com/{contentType}/
  // {slug}" — the CMS is frontend-agnostic (docs/ARCHITECTURE.md §15) and has no way to know an
  // arbitrary frontend's own routing, so the operator supplies the pattern their own site
  // actually uses. Substituted verbatim (no templating engine) by
  // apps/admin/src/pages/EntryEditorPage.tsx when building a preview link.
  previewUrl: text('preview_url'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
