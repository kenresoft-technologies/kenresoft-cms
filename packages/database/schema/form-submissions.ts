import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

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
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('form_submissions_form_id_idx').on(table.formId)],
);

export type FormSubmission = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;
