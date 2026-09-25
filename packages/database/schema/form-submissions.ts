import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

import { user } from './auth';
import { forms } from './forms';
// FORM_SUBMISSION_STATUSES itself lives in packages/contracts — see field-definitions.ts for why.
import type { FormSubmissionStatus } from '@kenresoft-cms/contracts';

export type { FormSubmissionStatus };

// Deliberately separate from Entry (§7) — a public submission is never CMS content, and
// keeping the tables apart means a bug in one write path can't leak into the other's data.
export const formSubmissions = sqliteTable(
  'form_submissions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    formId: text('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    // Field values keyed by FormField.name — sanitized and validated against the form's
    // field definitions at the API layer before being written here (§9).
    data: text('data', { mode: 'json' })
      .notNull()
      .$type<Record<string, unknown>>(),
    status: text('status').notNull().$type<FormSubmissionStatus>().default('new'),
    // True only for a submission created through the admin "Preview & Test" flow
    // (routes/admin/forms.ts's test-submissions route) — runs the exact same validation/file-
    // upload/notification pipeline a real visitor submission does, so it's a real row, not a
    // dry run, but flagged so it can be visually distinguished and excluded from any future
    // count/export feature by default (never silently mixed into real visitor data).
    isTest: integer('is_test', { mode: 'boolean' }).notNull().default(false),
    // The website account that owns this submission — set only by the server from the signed-in
    // session, for a form with requiresAccount. Null for anonymous submissions (every form
    // before this column existed), which no account can ever see.
    accountUserId: text('account_user_id').references(() => user.id, { onDelete: 'set null' }),
    // Current progress stage, one of the form's own `stages` — separate from `status`, which is
    // the staff inbox triage state and never shown to the account.
    stage: text('stage'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('form_submissions_form_id_idx').on(table.formId),
    index('form_submissions_account_user_id_idx').on(table.accountUserId),
  ],
);

// Each stage a submission has moved into, oldest first — the progress history an owning
// account sees. changedByUserId is null for the initial stage set on submission.
export const formSubmissionStageChanges = sqliteTable(
  'form_submission_stage_changes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    submissionId: text('submission_id')
      .notNull()
      .references(() => formSubmissions.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    changedByUserId: text('changed_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('form_submission_stage_changes_submission_id_idx').on(table.submissionId)],
);

export type FormSubmissionStageChange = typeof formSubmissionStageChanges.$inferSelect;

export type FormSubmission = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;
