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
  // Submission context: when set, a submission must name one published entry of this content type
  // (the server resolves it, the visitor never supplies a record), optionally only while that entry
  // is open for submissions. See FormContextConfig in contracts. Null for ordinary forms.
  contextConfig: text('context_config', { mode: 'json' }).$type<{
    contentType: string;
    openWhen?: { field: string; equals: string | boolean }[] | undefined;
    deadlineField?: string | undefined;
  } | null>(),
  // Field names whose combined, normalized values must be unique among real submissions (for a
  // waitlist: ["app", "email"], one registration per app and address). A repeat is refused with
  // 409. Null means duplicates are allowed, which is every existing form's behavior.
  uniqueFields: text('unique_fields', { mode: 'json' }).$type<string[] | null>(),
  // Opt-in Cloudflare Turnstile check on the public submit route. Enforced only when the
  // deployment also has TURNSTILE_SECRET_KEY set, so opting in never blocks a deployment that
  // has not configured Turnstile.
  requiresHumanCheck: integer('requires_human_check', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;
