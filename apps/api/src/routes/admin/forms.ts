import { createRoute } from '@hono/zod-openapi';
import {
  createFormFieldSchema,
  createFormSchema,
  createFormSubmissionReplySchema,
  formFieldSchema,
  formSchema,
  formSubmissionReplySchema,
  formSubmissionSchema,
  formSubmissionWithFormSchema,
  updateFormFieldSchema,
  updateFormSchema,
  updateFormSubmissionStatusSchema,
} from '@kenresoft-cms/contracts';
import type {
  Form,
  FormField,
  FormFieldType,
  FormSubmission,
  FormSubmissionReply,
  FormSubmissionStatus,
  FormSubmissionWithForm,
} from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { getEmailSender, isEmailProviderConfigured } from '../../lib/email';
import { getAdminFrom, getDefaultReplyTo } from '../../lib/email/admin-sender';
import { sendFormSubmissionNotification } from '../../lib/form-notifications';
import { collectAttachments, describeAttachments } from '../../lib/email/attachments';
import { buildBodies, parseComposeRequest } from '../../lib/email/compose';
import { deleteMediaIfUnreferenced } from '../../lib/media-service';
import { createOpenApiApp } from '../../lib/openapi';
import { parseSubmissionRequestBody, submitForm } from '../../lib/submit-form';
import { requireFormsAccess } from '../../middleware/require-forms-access';
import { adminEmailRateLimit } from '../../middleware/admin-email-rate-limit';
import { requireRole } from '../../middleware/require-role';
import {
  createFormField,
  deleteFormField,
  getFormFieldById,
  listFormFields,
  updateFormField,
} from '../../repositories/form-fields';
import {
  createFormSubmissionReply,
  listFormSubmissionReplies,
} from '../../repositories/form-submission-replies';
import {
  deleteFormSubmission,
  getFormSubmissionById,
  listSubmissionsWithForm,
  updateFormSubmissionStatus,
} from '../../repositories/form-submissions';
import { createForm, getFormById, listForms, updateForm } from '../../repositories/forms';
import { deleteAttachmentsForOwner } from '../../repositories/media-attachments';
import { getMediaById } from '../../repositories/media';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type {
  Form as DbForm,
  FormField as DbFormField,
  FormSubmission as DbFormSubmission,
  FormSubmissionReply as DbFormSubmissionReply,
} from '@kenresoft-cms/database';

export const formsRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

// Applies to every route in this file, including reads — see requireFormsAccess's own comment
// for why Forms/Submissions carve out a stricter boundary than Entries' role floor (Author gets
// no access at all here, not even read). Individual routes below still layer their own stricter
// requireRole(...) for admin-only writes (form/field structural changes) on top of this.
formsRoute.use('*', requireFormsAccess());

const notFoundSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });
const submissionParamsSchema = z.object({ id: z.string().min(1), submissionId: z.string().min(1) });
const fieldParamSchema = z.object({ id: z.string().min(1), fieldId: z.string().min(1) });

// A `file`-type field's value in FormSubmission.data. Two shapes coexist, per Phase 5's
// backward-compatible-readers requirement: the legacy `{key, ...}` shape (a bare R2 key, from
// before Media/media_attachments existed) and the current `{mediaId, ...}` shape (routes/public/
// forms.ts now uploads through Media, private by default). Never migrated in place — old
// submissions keep their original shape until an explicit, separate backfill (Phase 5's
// two-step migration plan).
type LegacyAttachment = { key: string; contentType: string; filename?: string };
type MediaRefAttachment = { mediaId: string; contentType: string; filename?: string };

function attachmentAt(data: Record<string, unknown>, fieldName: string): LegacyAttachment | MediaRefAttachment | null {
  const value = data[fieldName];
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record['mediaId'] === 'string') {
    return record as unknown as MediaRefAttachment;
  }
  if (typeof record['key'] === 'string' && typeof record['contentType'] === 'string') {
    return record as unknown as LegacyAttachment;
  }
  return null;
}

function toForm(row: DbForm): Form {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    notificationEmails: row.notificationEmails ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toFormField(row: DbFormField): FormField {
  return {
    id: row.id,
    formId: row.formId,
    name: row.name,
    label: row.label,
    fieldType: row.fieldType as FormFieldType,
    required: row.required,
    sortOrder: row.sortOrder,
    config: row.config ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toFormSubmissionReply(row: DbFormSubmissionReply & { authorName: string | null }): FormSubmissionReply {
  return {
    id: row.id,
    submissionId: row.submissionId,
    authorUserId: row.authorUserId,
    authorName: row.authorName,
    to: row.to,
    subject: row.subject,
    bodyHtml: row.bodyHtml,
    attachments: row.attachments ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

function toFormSubmission(row: DbFormSubmission): FormSubmission {
  return {
    id: row.id,
    formId: row.formId,
    data: row.data,
    status: row.status as FormSubmissionStatus,
    isTest: row.isTest,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toFormSubmissionWithForm(
  row: Awaited<ReturnType<typeof listSubmissionsWithForm>>[number],
): FormSubmissionWithForm {
  return {
    id: row.id,
    formId: row.formId,
    data: row.data,
    status: row.status as FormSubmissionStatus,
    isTest: row.isTest,
    createdAt: row.createdAt.toISOString(),
    formName: row.formName,
    formSlug: row.formSlug,
  };
}

formsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Forms'],
    summary: 'List every form',
    responses: {
      200: {
        description: 'Every form.',
        content: { 'application/json': { schema: z.array(formSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    return c.json((await listForms(db)).map(toForm), 200);
  },
);

// Forms are a top-level structural resource, same as content types (§11) — creating one is
// an admin-level action.
formsRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Forms'],
    summary: 'Create a form (admin only)',
    middleware: requireRole('admin'),
    request: {
      body: { content: { 'application/json': { schema: createFormSchema } } },
    },
    responses: {
      201: {
        description: 'The created form.',
        content: { 'application/json': { schema: formSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);
    const form = await createForm(db, input);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'form.created',
      targetType: 'form',
      targetId: form.id,
      metadata: { name: form.name, slug: form.slug },
    });
    return c.json(toForm(form), 201);
  },
);

formsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Forms'],
    summary: 'Get a form by id',
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'The form.',
        content: { 'application/json': { schema: formSchema } },
      },
      404: {
        description: 'No form with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const form = await getFormById(db, id);
    if (!form) {
      return c.json({ error: 'Form not found' }, 404);
    }
    return c.json(toForm(form), 200);
  },
);

// Admin-gated, same as creation — renaming/re-slugging a form is a structural change (§11).
formsRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Forms'],
    summary: 'Update a form (admin only)',
    middleware: requireRole('admin'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateFormSchema } } },
    },
    responses: {
      200: {
        description: 'The updated form.',
        content: { 'application/json': { schema: formSchema } },
      },
      404: {
        description: 'No form with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getFormById(db, id);
    if (!existing) {
      return c.json({ error: 'Form not found' }, 404);
    }

    const input = c.req.valid('json');
    const updated = await updateForm(db, id, input);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'form.updated',
      targetType: 'form',
      targetId: id,
      metadata: { ...input },
    });
    return c.json(toForm(updated!), 200);
  },
);

formsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/fields',
    tags: ['Forms'],
    summary: "List a form's field definitions",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Every field definition, in display order.',
        content: { 'application/json': { schema: z.array(formFieldSchema) } },
      },
      404: {
        description: 'No form with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const form = await getFormById(db, id);
    if (!form) {
      return c.json({ error: 'Form not found' }, 404);
    }
    const fields = await listFormFields(db, form.id);
    return c.json(fields.map(toFormField), 200);
  },
);

formsRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/fields',
    tags: ['Forms'],
    summary: 'Add a field definition to a form',
    middleware: requireRole('admin', 'editor'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: createFormFieldSchema } } },
    },
    responses: {
      201: {
        description: 'The created field definition.',
        content: { 'application/json': { schema: formFieldSchema } },
      },
      404: {
        description: 'No form with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const form = await getFormById(db, id);
    if (!form) {
      return c.json({ error: 'Form not found' }, 404);
    }

    const input = c.req.valid('json');
    const existingFields = await listFormFields(db, form.id);
    const field = await createFormField(db, {
      ...input,
      formId: form.id,
      sortOrder: input.sortOrder ?? existingFields.length,
    });
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'form_field.created',
      targetType: 'form_field',
      targetId: field.id,
      metadata: { formId: form.id, name: field.name, fieldType: field.fieldType },
    });
    return c.json(toFormField(field), 201);
  },
);

// admin/editor — matches field creation just above.
formsRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/fields/{fieldId}',
    tags: ['Forms'],
    summary: 'Update a field definition',
    middleware: requireRole('admin', 'editor'),
    request: {
      params: fieldParamSchema,
      body: { content: { 'application/json': { schema: updateFormFieldSchema } } },
    },
    responses: {
      200: {
        description: 'The updated field definition.',
        content: { 'application/json': { schema: formFieldSchema } },
      },
      404: {
        description: 'No form or field matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, fieldId } = c.req.valid('param');
    const db = getDb(c);
    const field = await getFormFieldById(db, fieldId);
    if (!field || field.formId !== id) {
      return c.json({ error: 'Field not found' }, 404);
    }

    const input = c.req.valid('json');
    const updated = await updateFormField(db, fieldId, input);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'form_field.updated',
      targetType: 'form_field',
      targetId: fieldId,
      metadata: { formId: id, ...input },
    });
    return c.json(toFormField(updated!), 200);
  },
);

formsRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/fields/{fieldId}',
    tags: ['Forms'],
    summary: 'Delete a field definition',
    middleware: requireRole('admin', 'editor'),
    request: { params: fieldParamSchema },
    responses: {
      204: { description: 'The field was deleted.' },
      404: {
        description: 'No form or field matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, fieldId } = c.req.valid('param');
    const db = getDb(c);
    const field = await getFormFieldById(db, fieldId);
    if (!field || field.formId !== id) {
      return c.json({ error: 'Field not found' }, 404);
    }

    await deleteFormField(db, fieldId);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'form_field.deleted',
      targetType: 'form_field',
      targetId: fieldId,
      metadata: { formId: id, name: field.name },
    });
    return c.body(null, 204);
  },
);

formsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/submissions',
    tags: ['Forms'],
    summary: "List a form's submissions",
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Every submission, newest first.',
        content: { 'application/json': { schema: z.array(formSubmissionWithFormSchema) } },
      },
      404: {
        description: 'No form with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const form = await getFormById(db, id);
    if (!form) {
      return c.json({ error: 'Form not found' }, 404);
    }
    const submissions = await listSubmissionsWithForm(db, form.id);
    return c.json(submissions.map(toFormSubmissionWithForm), 200);
  },
);

// "Preview & Test": submits a real test entry through the exact same validate/upload/notify
// pipeline the public route uses (submitForm() — shared, not a second copy), rather than a
// dry-run/simulation. That's deliberate: it's the only way to actually prove a form's file
// upload and email-notification paths work, not just that its field validation does. The
// resulting row is real (isTest: true) and appears in the inbox flagged, not hidden — the
// admin still gets a real thing to inspect. Gated by requireFormsAccess() alone (this route's
// `formsRoute.use('*', ...)` above) — the same editor+ floor "manage fields" already uses, since
// testing a form you can already edit needs no stricter gate; author/viewer are excluded/
// read-only exactly as they are everywhere else in this file. Never rate-limited by
// FORM_SUBMISSION_RATE_LIMITER — that budget exists for anonymous public traffic, not an
// authenticated admin verifying their own form.
formsRoute.post('/:id/test-submissions', async (c) => {
  const db = getDb(c);
  const form = await getFormById(db, c.req.param('id'));
  if (!form) {
    return c.json({ error: 'Form not found' }, 404);
  }

  const parsedBody = await parseSubmissionRequestBody(c.req.raw);
  if (!parsedBody.ok) {
    return c.json({ error: parsedBody.error }, 400);
  }

  const fields = await listFormFields(db, form.id);
  const result = await submitForm(db, c.env.MEDIA_BUCKET, form.id, fields, parsedBody.parsed, { isTest: true });
  if (!result.ok) {
    return c.json({ error: result.error, issues: result.issues }, 400);
  }

  sendFormSubmissionNotification(c.env, c.executionCtx, form, fields, result.submission, { isTest: true });
  await recordAudit(db, {
    actorUserId: c.get('user').id,
    action: 'form_submission.tested',
    targetType: 'form',
    targetId: form.id,
    metadata: { submissionId: result.submission.id },
  });
  return c.json(toFormSubmission(result.submission), 201);
});

formsRoute.openAPIRegistry.registerPath({
  method: 'post',
  path: '/{id}/test-submissions',
  tags: ['Forms'],
  summary: 'Submit a real test entry through this form, for admin verification (Preview & Test)',
  description:
    "Runs the exact same validation/file-upload/notification pipeline the public submission " +
    'route does, flagged isTest: true. The request body shape is dynamic, built from the ' +
    "form's own field definitions, the same as the public submission route.",
  request: {
    params: idParamSchema,
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } },
  },
  responses: {
    201: {
      description: 'The created test submission.',
      content: { 'application/json': { schema: formSubmissionSchema } },
    },
    400: {
      description: 'Malformed body, or the body failed the form-specific validation.',
      content: { 'application/json': { schema: notFoundSchema } },
    },
    404: {
      description: 'No form with that id.',
      content: { 'application/json': { schema: notFoundSchema } },
    },
  },
});

// Streams the raw attachment bytes — not a JSON response, so (like media.ts's own file route)
// this stays a plain route with a docs-only registerPath below. No role gate: viewing an
// attached file is a read action available to every authenticated role, same as viewing the
// submission's own text fields (§10 — Viewer is read-only, not read-nothing).
formsRoute.get('/:id/submissions/:submissionId/files/:fieldName', async (c) => {
  const { id, submissionId, fieldName } = c.req.param();
  const db = getDb(c);
  const form = await getFormById(db, id);
  if (!form) {
    return c.json({ error: 'Form not found' }, 404);
  }

  const submission = await getFormSubmissionById(db, submissionId);
  if (!submission || submission.formId !== form.id) {
    return c.json({ error: 'Submission not found' }, 404);
  }

  const attachment = attachmentAt(submission.data, fieldName);
  if (!attachment) {
    return c.json({ error: 'No file attached to that field' }, 404);
  }

  let key: string;
  if ('mediaId' in attachment) {
    const mediaRow = await getMediaById(db, attachment.mediaId);
    if (!mediaRow) {
      return c.json({ error: 'File missing from storage' }, 404);
    }
    key = mediaRow.key;
  } else {
    key = attachment.key;
  }

  const object = await c.env.MEDIA_BUCKET.get(key);
  if (!object) {
    return c.json({ error: 'File missing from storage' }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': attachment.contentType,
      'Content-Disposition': `attachment; filename="${(attachment.filename ?? 'file').replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});

formsRoute.openAPIRegistry.registerPath({
  method: 'get',
  path: '/{id}/submissions/{submissionId}/files/{fieldName}',
  tags: ['Forms'],
  summary: "Download a submitted attachment from a file-type field",
  request: {
    params: z.object({ id: z.string().min(1), submissionId: z.string().min(1), fieldName: z.string().min(1) }),
  },
  responses: {
    200: { description: 'The raw attachment bytes.' },
    404: {
      description: 'No form/submission matching those ids, no file attached to that field, or the file is missing from storage.',
      content: { 'application/json': { schema: notFoundSchema } },
    },
  },
});

// No role gate beyond the global viewer-mutation block (blockViewerMutations) — replying to a
// submission is an editorial action, same as triage just below. Requires a real EMAIL_PROVIDER
// (isEmailProviderConfigured), since there's nowhere to actually send from otherwise — 400s
// with a clear message rather than surfacing a raw provider error, matching this codebase's own
// "explain what's missing" convention (e.g. the database_id-missing error in scripts/update.mjs).
formsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/submissions/{submissionId}/replies',
    tags: ['Forms'],
    summary: 'List replies already sent to a submission',
    request: { params: submissionParamsSchema },
    responses: {
      200: {
        description: 'Every reply, oldest first.',
        content: { 'application/json': { schema: z.array(formSubmissionReplySchema) } },
      },
      404: {
        description: 'No form or submission matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, submissionId } = c.req.valid('param');
    const db = getDb(c);
    const form = await getFormById(db, id);
    if (!form) {
      return c.json({ error: 'Form not found' }, 404);
    }
    const submission = await getFormSubmissionById(db, submissionId);
    if (!submission || submission.formId !== form.id) {
      return c.json({ error: 'Submission not found' }, 404);
    }
    const replies = await listFormSubmissionReplies(db, submission.id);
    return c.json(replies.map(toFormSubmissionReply), 200);
  },
);

// Multipart (or JSON) so a reply can carry attachments — a plain route with a docs-only
// registerPath below, like media upload. Sends via the same infrastructure as the Email page.
formsRoute.post('/:id/submissions/:submissionId/replies', adminEmailRateLimit, async (c) => {
  const id = c.req.param('id');
  const submissionId = c.req.param('submissionId');
  const db = getDb(c);
  const form = await getFormById(db, id);
  if (!form) {
    return c.json({ error: 'Form not found' }, 404);
  }
  const submission = await getFormSubmissionById(db, submissionId);
  if (!submission || submission.formId !== form.id) {
    return c.json({ error: 'Submission not found' }, 404);
  }

  if (!isEmailProviderConfigured(c.env)) {
    return c.json(
      { error: 'This deployment has no email provider configured — see docs/DEPLOYMENT.md\'s recovery section.' },
      400,
    );
  }

  const parsed = await parseComposeRequest(c, createFormSubmissionReplySchema);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }
  const { fields, files, mediaIds } = parsed.value;
  const { to, subject } = fields;
  const author = c.get('user');

  const collected = await collectAttachments(c.env, db, { files, mediaIds });
  if (!collected.ok) {
    return c.json({ error: collected.error }, 400);
  }

  // Sanitized BEFORE it's ever sent or persisted — the persisted value is later rendered with
  // dangerouslySetInnerHTML for every role with Forms/Submissions access (html-sanitizer.ts).
  const bodies = buildBodies(fields.bodyHtml);
  const bodyHtml = bodies.html;

  const from = await getAdminFrom(db);
  try {
    await getEmailSender(c.env).send({
      to,
      subject,
      ...bodies,
      replyTo: fields.replyTo ?? (await getDefaultReplyTo(db, author.email)),
      ...(from ? { from } : {}),
      ...(collected.attachments.length ? { attachments: collected.attachments } : {}),
    });
  } catch (error) {
    console.error('Failed to send a form-submission reply:', error);
    return c.json({ error: 'The email provider rejected or failed to send this message.' }, 502);
  }

  const reply = await createFormSubmissionReply(db, {
    submissionId: submission.id,
    authorUserId: author.id,
    to,
    subject,
    bodyHtml,
    attachments: describeAttachments(collected.attachments),
  });
  await recordAudit(db, {
    actorUserId: author.id,
    action: 'form_submission.replied',
    targetType: 'form_submission',
    targetId: submission.id,
    metadata: { formId: id, to, subject, attachments: collected.attachments.length },
  });
  // authorName isn't on SessionUser — the client already knows its own display name.
  return c.json(toFormSubmissionReply({ ...reply, authorName: null }), 201);
});

formsRoute.openAPIRegistry.registerPath({
  method: 'post',
  path: '/{id}/submissions/{submissionId}/replies',
  tags: ['Forms'],
  summary: 'Send a reply to a submission by email',
  description:
    "Sends through this deployment's configured email provider with Reply-To defaulting to the " +
    "configured Email sender address (else the staff member's email); optional `replyTo` overrides it. multipart/form-data with `to`, `subject`, `bodyHtml`, and " +
    'optional `files` / `mediaIds` attachments (JSON without attachments also accepted). ' +
    '400s if no EMAIL_PROVIDER is configured or attachments exceed the provider limits.',
  request: {
    params: submissionParamsSchema,
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            to: z.string(),
            subject: z.string(),
            bodyHtml: z.string(),
            replyTo: z.string().optional(),
            files: z.array(z.string().openapi({ type: 'string', format: 'binary' })).optional(),
            mediaIds: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: 'The reply was sent and recorded.', content: { 'application/json': { schema: formSubmissionReplySchema } } },
    400: { description: 'No provider configured, invalid input, or attachments over limit.', content: { 'application/json': { schema: notFoundSchema } } },
    404: { description: 'No form or submission matching those ids.', content: { 'application/json': { schema: notFoundSchema } } },
    502: { description: 'The provider failed to send.', content: { 'application/json': { schema: notFoundSchema } } },
  },
});

// No role gate — triaging submissions (new/read/archived) is an editorial action, same as
// entry create/edit, which also has no server-side role check.
formsRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/submissions/{submissionId}',
    tags: ['Forms'],
    summary: "Update a submission's triage status",
    request: {
      params: submissionParamsSchema,
      body: { content: { 'application/json': { schema: updateFormSubmissionStatusSchema } } },
    },
    responses: {
      200: {
        description: 'The updated submission.',
        content: { 'application/json': { schema: formSubmissionSchema } },
      },
      404: {
        description: 'No form or submission matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, submissionId } = c.req.valid('param');
    const db = getDb(c);
    const form = await getFormById(db, id);
    if (!form) {
      return c.json({ error: 'Form not found' }, 404);
    }

    const submission = await getFormSubmissionById(db, submissionId);
    if (!submission || submission.formId !== form.id) {
      return c.json({ error: 'Submission not found' }, 404);
    }

    const { status } = c.req.valid('json');
    const updated = await updateFormSubmissionStatus(db, submission.id, status);
    return c.json(toFormSubmission(updated), 200);
  },
);

// Unlike triage (no role gate above), deleting visitor-submitted data permanently is
// destructive and irreversible — gated the same as media.deleted/entries delete.
formsRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/submissions/{submissionId}',
    tags: ['Forms'],
    summary: 'Delete a submission',
    middleware: requireRole('admin', 'editor'),
    request: { params: submissionParamsSchema },
    responses: {
      204: { description: 'The submission was deleted.' },
      404: {
        description: 'No form or submission matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id, submissionId } = c.req.valid('param');
    const db = getDb(c);
    const form = await getFormById(db, id);
    if (!form) {
      return c.json({ error: 'Form not found' }, 404);
    }

    const submission = await getFormSubmissionById(db, submissionId);
    if (!submission || submission.formId !== form.id) {
      return c.json({ error: 'Submission not found' }, 404);
    }

    // The submission's own attachment relationships have no real FK to form_submissions
    // (media_attachments is deliberately domain-agnostic — Phase 5), so they're cleaned up
    // explicitly here rather than relying on a DB cascade. Removing the relationship first, then
    // only physically deleting the underlying Media/R2 object if nothing else still references
    // it, is the exact "remove relationship → check remaining references → delete only if
    // unreferenced" behavior Phase 5 requires — never a blind delete that could destroy a Media
    // asset another owner still points at.
    const attachments = await deleteAttachmentsForOwner(db, 'form_submission', submissionId);
    await deleteFormSubmission(db, submissionId);
    for (const attachment of attachments) {
      await deleteMediaIfUnreferenced(db, c.env.MEDIA_BUCKET, attachment.mediaId);
    }

    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: 'form_submission.deleted',
      targetType: 'form_submission',
      targetId: submissionId,
      metadata: { formId: id },
    });
    return c.body(null, 204);
  },
);
