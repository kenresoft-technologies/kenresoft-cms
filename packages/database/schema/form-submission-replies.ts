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
    // 'outbound' is a staff reply (emailed to `to`); 'inbound' is a message the owning account
    // posted through /api/v1/account/forms, which has no recipient or subject of its own.
    direction: text('direction').notNull().$type<'outbound' | 'inbound'>().default('outbound'),
    to: text('to'),
    subject: text('subject'),
    // The rich-text compose box's HTML output — the plain-text part sent alongside it
    // (form-notifications.ts-style multipart email) is derived from this at send time, not
    // stored separately, since it's always mechanically re-derivable from the HTML.
    bodyHtml: text('body_html').notNull(),
    // Metadata for this message's attachments. Every attachment carries a mediaId: uploaded
    // files are kept as private Media (media_attachments owner 'form_submission_reply'), so the
    // owning account and staff can download them later. Rows from before that change have
    // metadata only for uploads (no mediaId), since the file itself was only emailed.
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
