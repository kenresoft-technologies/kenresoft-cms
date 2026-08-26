import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

import { forms } from './forms';

export const FORM_SUBMISSION_STATUSES = ['new', 'read', 'archived'] as const;
export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number];

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
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('form_submissions_form_id_idx').on(table.formId)],
);

export type FormSubmission = typeof formSubmissions.$inferSelect;
export type NewFormSubmission = typeof formSubmissions.$inferInsert;
