import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Reusable key/value pairs (a phone number, an office address, a promo banner's text) that
// would otherwise get hand-copied into every content type/entry that needs them. Values are
// plain text — a rich-text or structured value belongs in a real content type's field instead,
// same boundary as SonicJS's own "Global Variables" this feature is modeled on. Exposed
// read-only to the public API (unauthenticated, like published entries) so a frontend can
// actually consume them, not just view them in the admin.
export const globalVariables = sqliteTable('global_variables', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type GlobalVariable = typeof globalVariables.$inferSelect;
export type NewGlobalVariable = typeof globalVariables.$inferInsert;
