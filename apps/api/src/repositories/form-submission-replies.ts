import { asc, eq, formSubmissionReplies, user } from '@kenresoft-cms/database';
import type { Database, FormSubmissionReply, NewFormSubmissionReply } from '@kenresoft-cms/database';

export function createFormSubmissionReply(
  db: Database,
  input: Pick<NewFormSubmissionReply, 'submissionId' | 'authorUserId' | 'direction' | 'to' | 'subject' | 'bodyHtml'> & {
    attachments: NonNullable<FormSubmissionReply['attachments']>;
  },
): Promise<FormSubmissionReply> {
  return db
    .insert(formSubmissionReplies)
    .values(input)
    .returning()
    .then(([reply]) => reply!);
}

export async function deleteFormSubmissionReply(db: Database, id: string): Promise<void> {
  await db.delete(formSubmissionReplies).where(eq(formSubmissionReplies.id, id));
}

// Joined with the author's current name — a reply thread reads as "who said what," and a
// deleted account (authorUserId set null by the FK above) should still show the thread entry,
// just without an author name.
export function listFormSubmissionReplies(
  db: Database,
  submissionId: string,
): Promise<(FormSubmissionReply & { authorName: string | null })[]> {
  return db
    .select({
      id: formSubmissionReplies.id,
      submissionId: formSubmissionReplies.submissionId,
      authorUserId: formSubmissionReplies.authorUserId,
      direction: formSubmissionReplies.direction,
      to: formSubmissionReplies.to,
      subject: formSubmissionReplies.subject,
      bodyHtml: formSubmissionReplies.bodyHtml,
      attachments: formSubmissionReplies.attachments,
      createdAt: formSubmissionReplies.createdAt,
      authorName: user.name,
    })
    .from(formSubmissionReplies)
    .leftJoin(user, eq(formSubmissionReplies.authorUserId, user.id))
    .where(eq(formSubmissionReplies.submissionId, submissionId))
    .orderBy(asc(formSubmissionReplies.createdAt));
}
