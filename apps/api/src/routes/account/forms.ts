import { createRoute } from '@hono/zod-openapi';
import {
  accountSubmissionDetailSchema,
  accountSubmissionMessageSchema,
  accountSubmissionSummarySchema,
  createAccountSubmissionMessageSchema,
} from '@kenresoft-cms/contracts';
import type { AccountSubmissionDetail, AccountSubmissionMessage, AccountSubmissionSummary } from '@kenresoft-cms/contracts';
import type { Form, FormSubmission, FormSubmissionReply } from '@kenresoft-cms/database';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { escapeHtml } from '../../lib/email-templates/render';
import type { Bindings } from '../../lib/env';
import { createOpenApiApp } from '../../lib/openapi';
import {
  deleteMediaFiles,
  findSubmissionFile,
  linkMessageFiles,
  mediaDownloadResponse,
  notifyStaffOfAccountMessage,
  submissionFiles,
  uploadMessageFiles,
} from '../../lib/submission-thread';
import { requireAccount, requireAccountOrigin } from '../../middleware/require-account';
import type { AccountVariables } from '../../middleware/require-account';
import {
  createFormSubmissionReply,
  deleteFormSubmissionReply,
  listFormSubmissionReplies,
} from '../../repositories/form-submission-replies';
import { getAccountSubmission, listAccountSubmissions, listStageChanges } from '../../repositories/form-submissions';

// The signed-in account's own submissions, for forms with requiresAccount. Every route resolves
// the submission through getAccountSubmission, which filters on the session's account id, so
// another account's submission (or file) is always a plain 404 — never a 403 that would confirm
// it exists. Staff reply bodies were sanitized when sent; account messages are stored escaped.
export const accountFormsRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AccountVariables }>();

accountFormsRoute.use('*', requireAccount);
accountFormsRoute.use('*', requireAccountOrigin);

const MAX_MESSAGE_FILES = 5;
const notFoundSchema = z.object({ error: z.string() });
const submissionParamsSchema = z.object({ submissionId: z.string().min(1) });

type ReplyRow = FormSubmissionReply & { authorName: string | null };

function latest(dates: Date[]): string {
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function toSummary(
  submission: FormSubmission,
  form: Pick<Form, 'name' | 'slug' | 'stages'>,
  activity: Date[],
): AccountSubmissionSummary {
  return {
    id: submission.id,
    formSlug: form.slug,
    formName: form.name,
    data: submission.data,
    stage: submission.stage,
    stages: form.stages ?? null,
    createdAt: submission.createdAt.toISOString(),
    lastActivityAt: latest([submission.createdAt, ...activity]),
  };
}

function toMessage(reply: ReplyRow): AccountSubmissionMessage {
  return {
    id: reply.id,
    from: reply.direction === 'inbound' ? 'account' : 'staff',
    bodyHtml: reply.bodyHtml,
    // Only attachments the thread still holds a file for; a legacy upload that was only emailed
    // has no mediaId and nothing to download.
    attachments: (reply.attachments ?? []).flatMap((attachment) =>
      attachment.mediaId
        ? [{ mediaId: attachment.mediaId, filename: attachment.filename, contentType: attachment.contentType, size: attachment.size }]
        : [],
    ),
    createdAt: reply.createdAt.toISOString(),
  };
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

accountFormsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/submissions',
    tags: ['Account'],
    summary: "List the signed-in account's own submissions",
    request: { query: z.object({ form: z.string().optional() }) },
    responses: {
      200: {
        description: 'Every submission the account owns, newest first. Pass `form` (a form slug) to narrow to one form.',
        content: { 'application/json': { schema: z.array(accountSubmissionSummarySchema) } },
      },
      401: { description: 'Not signed in.', content: { 'application/json': { schema: notFoundSchema } } },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const { form } = c.req.valid('query');
    const rows = await listAccountSubmissions(db, c.get('account').id, form);
    const summaries = await Promise.all(
      rows.map(async (row) => {
        const [replies, stageChanges] = await Promise.all([
          listFormSubmissionReplies(db, row.submission.id),
          listStageChanges(db, row.submission.id),
        ]);
        return toSummary(
          row.submission,
          { name: row.formName, slug: row.formSlug, stages: row.stages },
          [...replies.map((reply) => reply.createdAt), ...stageChanges.map((change) => change.createdAt)],
        );
      }),
    );
    return c.json(summaries, 200);
  },
);

accountFormsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/submissions/{submissionId}',
    tags: ['Account'],
    summary: 'Get one of the account’s own submissions, with its progress and messages',
    request: { params: submissionParamsSchema },
    responses: {
      200: {
        description: 'The submission.',
        content: { 'application/json': { schema: accountSubmissionDetailSchema } },
      },
      401: { description: 'Not signed in.', content: { 'application/json': { schema: notFoundSchema } } },
      404: {
        description: 'No submission with that id owned by this account.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const { submissionId } = c.req.valid('param');
    const row = await getAccountSubmission(db, c.get('account').id, submissionId);
    if (!row) {
      return c.json({ error: 'Submission not found' }, 404);
    }
    const [replies, stageChanges] = await Promise.all([
      listFormSubmissionReplies(db, row.submission.id),
      listStageChanges(db, row.submission.id),
    ]);
    const detail: AccountSubmissionDetail = {
      ...toSummary(row.submission, row.form, [
        ...replies.map((reply) => reply.createdAt),
        ...stageChanges.map((change) => change.createdAt),
      ]),
      files: submissionFiles(row.submission.data),
      stageHistory: stageChanges.map((change) => ({ stage: change.stage, createdAt: change.createdAt.toISOString() })),
      messages: replies.map(toMessage),
    };
    return c.json(detail, 200);
  },
);

// Streams a file that belongs to the account's own submission: one it submitted with the form,
// or one attached to a message on its thread. Streamed as an attachment download, never inline.
accountFormsRoute.get('/submissions/:submissionId/files/:mediaId', async (c) => {
  const db = getDb(c);
  const { submissionId, mediaId } = c.req.param();
  const row = await getAccountSubmission(db, c.get('account').id, submissionId);
  if (!row) {
    return c.json({ error: 'File not found' }, 404);
  }
  const file = await findSubmissionFile(db, row.submission, await listFormSubmissionReplies(db, submissionId), mediaId);
  const response = file ? await mediaDownloadResponse(c.env.MEDIA_BUCKET, file.media, file.filename) : null;
  return response ?? c.json({ error: 'File not found' }, 404);
});

accountFormsRoute.openAPIRegistry.registerPath({
  method: 'get',
  path: '/submissions/{submissionId}/files/{mediaId}',
  tags: ['Account'],
  summary: 'Download a file from one of the account’s own submissions',
  request: { params: z.object({ submissionId: z.string(), mediaId: z.string() }) },
  responses: {
    200: { description: 'The raw file bytes, as an attachment download.' },
    401: { description: 'Not signed in.', content: { 'application/json': { schema: notFoundSchema } } },
    404: {
      description: 'No such submission owned by this account, or that file is not part of it.',
      content: { 'application/json': { schema: notFoundSchema } },
    },
  },
});

// Multipart (`body`, optional `files`) or JSON (`body` only). Rate limited per account with the
// same budget as public form submissions.
accountFormsRoute.post('/submissions/:submissionId/messages', async (c) => {
  const db = getDb(c);
  const account = c.get('account');
  const row = await getAccountSubmission(db, account.id, c.req.param('submissionId'));
  if (!row) {
    return c.json({ error: 'Submission not found' }, 404);
  }

  const { success } = await c.env.FORM_SUBMISSION_RATE_LIMITER.limit({ key: `account:${account.id}` });
  if (!success) {
    return c.json({ error: 'Too many messages, please try again later' }, 429);
  }

  let raw: Record<string, unknown>;
  let files: File[] = [];
  const contentType = c.req.header('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData();
      raw = { body: form.get('body') };
      files = form.getAll('files').filter((value): value is File => typeof value !== 'string');
    } else {
      raw = (await c.req.json()) as Record<string, unknown>;
    }
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }
  const parsed = createAccountSubmissionMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Write a message before sending' }, 400);
  }
  if (files.length > MAX_MESSAGE_FILES) {
    return c.json({ error: `Attach at most ${MAX_MESSAGE_FILES} files per message` }, 400);
  }

  const stored = await uploadMessageFiles(
    db,
    c.env.MEDIA_BUCKET,
    await Promise.all(files.map(async (file) => ({ filename: file.name || 'file', bytes: new Uint8Array(await file.arrayBuffer()) }))),
  );
  if (!stored.ok) {
    return c.json({ error: stored.error }, stored.status);
  }

  // The message and its file links are written together or not at all: if either fails, the
  // message is removed along with the files, and the student sees an error they can retry.
  let reply: FormSubmissionReply | null = null;
  try {
    reply = await createFormSubmissionReply(db, {
      submissionId: row.submission.id,
      authorUserId: account.id,
      direction: 'inbound',
      to: null,
      subject: null,
      bodyHtml: plainTextToHtml(parsed.data.body),
      attachments: stored.uploaded.map(({ media }) => ({
        filename: media.filename,
        contentType: media.contentType,
        size: media.size,
        source: 'upload' as const,
        mediaId: media.id,
      })),
    });
    await linkMessageFiles(
      db,
      reply.id,
      stored.uploaded.map(({ media }) => media.id),
    );
  } catch (error) {
    console.error('Failed to save an account message:', error);
    if (reply) await deleteFormSubmissionReply(db, reply.id).catch(() => undefined);
    await deleteMediaFiles(db, c.env.MEDIA_BUCKET, stored.uploaded.map(({ media }) => media.id));
    return c.json({ error: 'Your message could not be saved. Nothing was sent, please try again.' }, 500);
  }

  await recordAudit(db, {
    actorUserId: account.id,
    action: 'form_submission.account_message',
    targetType: 'form_submission',
    targetId: row.submission.id,
    metadata: { formId: row.form.id, attachments: stored.uploaded.length },
  });
  notifyStaffOfAccountMessage(c.env, c.executionCtx, row.form, row.submission.id, account);
  return c.json(toMessage({ ...reply, authorName: account.name }), 201);
});

accountFormsRoute.openAPIRegistry.registerPath({
  method: 'post',
  path: '/submissions/{submissionId}/messages',
  tags: ['Account'],
  summary: 'Post a message (with optional files) on one of the account’s own submissions',
  description:
    'multipart/form-data with `body` and up to 5 `files` (PDF, DOCX or image, 10 MB each), or JSON ' +
    "with `body`. Files are stored privately and only downloadable by this account and staff. The form's " +
    'notification recipients are emailed. Needs a trusted Origin.',
  request: {
    params: submissionParamsSchema,
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            body: z.string(),
            files: z.array(z.string().openapi({ type: 'string', format: 'binary' })).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: 'The posted message.', content: { 'application/json': { schema: accountSubmissionMessageSchema } } },
    400: { description: 'Empty message, too many files, or an unsupported file.', content: { 'application/json': { schema: notFoundSchema } } },
    401: { description: 'Not signed in.', content: { 'application/json': { schema: notFoundSchema } } },
    403: { description: 'Untrusted or missing Origin.', content: { 'application/json': { schema: notFoundSchema } } },
    404: { description: 'No such submission owned by this account.', content: { 'application/json': { schema: notFoundSchema } } },
    429: { description: 'Rate limit exceeded for this account.', content: { 'application/json': { schema: notFoundSchema } } },
  },
});
