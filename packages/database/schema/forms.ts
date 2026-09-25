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
  // Account-linked submissions: when set, only a signed-in, verified website account can submit,
  // and the submission is owned by that account (form_submissions.account_user_id), which can
  // then follow it through /api/v1/account/forms. Off by default, so anonymous forms are unchanged.
  requiresAccount: integer('requires_account', { mode: 'boolean' }).notNull().default(false),
  // Ordered progress stages staff move a submission through (e.g. "Submitted" → "Completed").
  // Per form and free-text, never a global list; null means the form has no stage workflow.
  stages: text('stages', { mode: 'json' }).$type<string[] | null>(),
  // Where the owning account views a submission on the site, with `{id}` replaced by the
  // submission id — the link in update emails. Null falls back to the site URL.
  accountSubmissionUrl: text('account_submission_url'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;
