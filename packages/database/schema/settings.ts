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
  featureFlags: text('feature_flags', { mode: 'json' }).$type<Record<string, boolean>>(),
  // Live Preview's URL template for the public frontend, e.g. "https://mysite.com/{contentType}/
  // {slug}" — the CMS is frontend-agnostic (docs/ARCHITECTURE.md §15) and has no way to know an
  // arbitrary frontend's own routing, so the operator supplies the pattern their own site
  // actually uses. Substituted verbatim (no templating engine) by
  // apps/admin/src/pages/EntryEditorPage.tsx when building a preview link.
  previewUrl: text('preview_url'),
  // Phase 5 of the schema-driven frontend work (docs/SITE_BUILDER.md §1.3/§20) — the equivalent
  // template for Pages, which have no content-type/slug pair, only a single literal `route`,
  // e.g. "https://mysite.com{route}". Kept as its own column rather than overloading
  // `previewUrl` with two incompatible placeholder shapes.
  pagePreviewUrl: text('page_preview_url'),
  // Optional From identity for admin-initiated emails (form replies, the admin "send email"
  // route) — never for system mail (password reset, verification), which stays on EMAIL_FROM.
  // The domain must be verified/onboarded with the configured EMAIL_PROVIDER. Null = use
  // EMAIL_FROM as before.
  emailSenderName: text('email_sender_name'),
  emailSenderEmail: text('email_sender_email'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
