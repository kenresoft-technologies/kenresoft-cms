import type { Database, Form, FormSubmission, FormSubmissionReply, Media } from '@kenresoft-cms/database';

import { getEmailSender } from './email';
import { prepareTemplatedEmail, sendPreparedEmail } from './email-templates/send';
import type { Bindings } from './env';
import { deleteMediaFile, uploadMedia } from './media-service';
import { createMediaAttachment } from '../repositories/media-attachments';
import { getMediaById } from '../repositories/media';
import { getUserById } from '../repositories/users';

type WaitUntilContext = Pick<ExecutionContext, 'waitUntil'>;
type AttachmentMeta = NonNullable<FormSubmissionReply['attachments']>[number];

export const REPLY_ATTACHMENT_OWNER = 'form_submission_reply';

// Stores files posted with a message as private Media, so the thread keeps them after any email
// has gone. Every file is sniffed by uploadMedia (PDF, DOCX or image). If any file is rejected
// (status 400) or can't be stored (status 500), the files already stored in this batch are
// deleted again, so a message is never half-attached and nothing is left orphaned.
export async function uploadMessageFiles(
  db: Database,
  bucket: R2Bucket,
  files: { filename: string; bytes: Uint8Array }[],
): Promise<{ ok: true; uploaded: { media: Media }[] } | { ok: false; status: 400 | 500; error: string }> {
  const uploaded: { media: Media }[] = [];
  let failure: { status: 400 | 500; error: string } | null = null;
  for (const file of files) {
    try {
      const result = await uploadMedia(db, bucket, {
        bytes: file.bytes,
        filename: file.filename,
        altText: null,
        visibility: 'private',
      });
      if (!result.ok) {
        failure = { status: 400, error: `"${file.filename}": ${result.error}` };
        break;
      }
      uploaded.push({ media: result.media });
    } catch (error) {
      console.error('Failed to store a message file:', error);
      failure = { status: 500, error: 'Your files could not be saved. Nothing was sent, please try again.' };
      break;
    }
  }
  if (failure) {
    await deleteMediaFiles(db, bucket, uploaded.map(({ media }) => media.id));
    return { ok: false, ...failure };
  }
  return { ok: true, uploaded };
}

// Removes Media created moments ago for a message or submission that is being abandoned. Each
// delete runs even if another fails. Deleting a Media row also removes its attachment rows.
export async function deleteMediaFiles(db: Database, bucket: R2Bucket, mediaIds: string[]): Promise<void> {
  const results = await Promise.allSettled(mediaIds.map((id) => deleteMediaFile(db, bucket, id)));
  for (const result of results) {
    if (result.status === 'rejected') console.error('Failed to remove an abandoned file:', result.reason);
  }
}

export async function linkMessageFiles(db: Database, replyId: string, mediaIds: string[]): Promise<void> {
  for (const mediaId of mediaIds) {
    await createMediaAttachment(db, { mediaId, ownerType: REPLY_ATTACHMENT_OWNER, ownerId: replyId, fieldName: null });
  }
}

// Files submitted with the form itself, keyed by field name — only the current `{mediaId}` shape.
export function submissionFiles(data: Record<string, unknown>) {
  const files: Record<string, { mediaId: string; filename: string; contentType: string; size: number }> = {};
  for (const [name, value] of Object.entries(data)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    if (typeof record['mediaId'] !== 'string') continue;
    files[name] = {
      mediaId: record['mediaId'],
      filename: typeof record['filename'] === 'string' ? record['filename'] : 'file',
      contentType: typeof record['contentType'] === 'string' ? record['contentType'] : 'application/octet-stream',
      size: typeof record['size'] === 'number' ? record['size'] : 0,
    };
  }
  return files;
}

// Resolves a mediaId only if it belongs to this submission: one of its own file fields or an
// attachment on one of its messages. Anything else — another submission's file, an arbitrary
// Media Library item — is treated as not found.
export async function findSubmissionFile(
  db: Database,
  submission: Pick<FormSubmission, 'data'>,
  replies: Pick<FormSubmissionReply, 'attachments'>[],
  mediaId: string,
): Promise<{ media: Media; filename: string } | null> {
  const fromData = Object.values(submissionFiles(submission.data)).find((file) => file.mediaId === mediaId);
  const fromReplies = replies
    .flatMap((reply) => reply.attachments ?? [])
    .find((attachment: AttachmentMeta) => attachment.mediaId === mediaId);
  const filename = fromData?.filename ?? fromReplies?.filename;
  if (!filename) return null;
  const media = await getMediaById(db, mediaId);
  return media ? { media, filename } : null;
}

export async function mediaDownloadResponse(bucket: R2Bucket, media: Media, filename: string): Promise<Response | null> {
  const object = await bucket.get(media.key);
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      'Content-Type': media.contentType,
      'Content-Disposition': `attachment; filename="${filename.replace(/["\\\r\n]/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function accountSubmissionUrl(form: Pick<Form, 'accountSubmissionUrl'>, submissionId: string): string | null {
  return form.accountSubmissionUrl ? form.accountSubmissionUrl.replaceAll('{id}', encodeURIComponent(submissionId)) : null;
}

// Tells the owning account its submission moved to another stage, through the admin-editable
// `form_submission_update` template. Skipped when the form has no accountSubmissionUrl, since
// the email's only purpose is to send the account to that page. The template is prepared inline
// and only the provider call is backgrounded (see prepareTemplatedEmail's comment). Never throws:
// a failed email must not undo a stage change.
export async function notifyAccountOfStageChange(
  db: Database,
  env: Bindings,
  ctx: WaitUntilContext,
  form: Pick<Form, 'name' | 'accountSubmissionUrl'>,
  submission: Pick<FormSubmission, 'id' | 'accountUserId'>,
  stage: string,
): Promise<void> {
  const submissionUrl = accountSubmissionUrl(form, submission.id);
  if (!submission.accountUserId || !submissionUrl) return;
  try {
    const account = await getUserById(db, submission.accountUserId);
    if (!account) return;
    const rendered = await prepareTemplatedEmail(db, env, 'form_submission_update', {
      'user.name': account.name,
      'user.email': account.email,
      'form.name': form.name,
      stage,
      submissionUrl,
    });
    ctx.waitUntil(
      sendPreparedEmail(env, account.email, rendered).catch((error: unknown) => {
        console.error('Failed to send a submission update email:', error);
      }),
    );
  } catch (error) {
    console.error('Failed to prepare a submission update email:', error);
  }
}

// Tells the form's notification recipients the owning account posted a message.
export function notifyStaffOfAccountMessage(
  env: Bindings,
  ctx: WaitUntilContext,
  form: Pick<Form, 'id' | 'name' | 'notificationEmails'>,
  submissionId: string,
  account: { name: string; email: string },
): void {
  const recipients = form.notificationEmails;
  if (!recipients || recipients.length === 0) return;
  const adminUrl = env.ADMIN_URL ?? env.CORS_ORIGINS.split(',')[0]?.trim();
  const link = adminUrl ? `${adminUrl}/forms/${form.id}/submissions/${submissionId}` : null;
  const subject = `New message: ${form.name}`;
  const text =
    `${account.name} (${account.email}) sent a new message on their "${form.name}" submission.` +
    (link ? `\n\nRead and reply in the admin: ${link}` : '');
  ctx.waitUntil(
    Promise.all(
      recipients.map(async (to) => {
        try {
          await getEmailSender(env).send({ to, subject, text });
        } catch (error) {
          console.error(`Failed to send an account-message notification to ${to}:`, error);
        }
      }),
    ),
  );
}
