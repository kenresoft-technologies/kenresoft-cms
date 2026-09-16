import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// A public-facing form definition (§7) — distinct from ContentType/Entry, which model
// editor-authored content, not visitor-submitted data.
export const forms = sqliteTable('forms', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // Who gets emailed when a visitor submits this form — null/empty means no notification is
  // sent (opt-in, matching this codebase's own EMAIL_PROVIDER-unset-is-fine convention rather
  // than assuming every deployment wants email for every form). Per-form, not a single
  // deployment-wide address, since a "Job Application" form and a "Contact" form legitimately
  // want different recipients.
  notificationEmails: text('notification_emails', { mode: 'json' }).$type<string[] | null>(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;
