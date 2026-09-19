import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

import { formSubmissions } from './form-submissions';
import { user } from './auth';

// A sent reply to a form submission — kept as a durable thread rather than fire-and-forget, so
// a shared inbox (multiple staff triaging the same form) can see what's already been said
// before replying again. authorUserId is set null on delete rather than cascaded (onDelete:
// 'set null') — deleting a staff account shouldn't erase the historical record that a reply was
// sent, only who specifically sent it.
export const formSubmissionReplies = sqliteTable(
  'form_submission_replies',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    submissionId: text('submission_id')
      .notNull()
      .references(() => formSubmissions.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    // The rich-text compose box's HTML output — the plain-text part sent alongside it
    // (form-notifications.ts-style multipart email) is derived from this at send time, not
    // stored separately, since it's always mechanically re-derivable from the HTML.
    bodyHtml: text('body_html').notNull(),
    // Metadata only (filename/type/size/source) for attachments sent with this reply — never the
    // binary. Media Library attachments also carry their mediaId.
    attachments: text('attachments', { mode: 'json' }).$type<
      { filename: string; contentType: string; size: number; source: 'upload' | 'media'; mediaId?: string }[]
    >(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('form_submission_replies_submission_id_idx').on(table.submissionId)],
);

export type FormSubmissionReply = typeof formSubmissionReplies.$inferSelect;
export type NewFormSubmissionReply = typeof formSubmissionReplies.$inferInsert;
