import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { StructuredSettingsModule } from '@kenresoft-cms/contracts';

export type { StructuredSettingsModule };

// Structured Settings (docs/ARCHITECTURE.md §6): singleton, typed, schema-validated site
// configuration — a distinct domain from both Global Variables (arbitrary key/value,
// global-variables.ts) and the CMS-internal `settings` table (deployment-operational config).
// One row per module (general/contact/social/navigation/footer/seo), `data` is that module's
// own validated JSON shape (packages/contracts/schemas/structured-settings.ts) — module
// validity/shape is enforced at the API/Zod layer, not a DB CHECK constraint, matching every
// other enum-shaped column in this schema (entries.status, user.role, ...).
export const structuredSettings = sqliteTable('structured_settings', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  module: text('module').notNull().unique().$type<StructuredSettingsModule>(),
  data: text('data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type StructuredSettingsRow = typeof structuredSettings.$inferSelect;
export type NewStructuredSettingsRow = typeof structuredSettings.$inferInsert;
