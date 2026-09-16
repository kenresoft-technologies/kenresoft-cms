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
import { sanitizeReplyHtml } from '../../lib/html-sanitizer';
import { htmlToPlainText } from '../../lib/html-to-text';
import { createOpenApiApp } from '../../lib/openapi';
import { requireFormsAccess } from '../../middleware/require-forms-access';
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

// A `file`-type field's value in FormSubmission.data — see routes/public/forms.ts, where a
// submitted attachment is uploaded to R2 and this shape is written in the field's place.
function attachmentAt(data: Record<string, unknown>, fieldName: string) {
  const value = data[fieldName];
  if (
    value &&
    typeof value === 'object' &&
    'key' in value &&
    typeof (value as { key: unknown }).key === 'string' &&
    'contentType' in value &&
    typeof (value as { contentType: unknown }).contentType === 'string'
  ) {
    return value as { key: string; contentType: string; filename?: string };
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
    createdAt: row.createdAt.toISOString(),
  };
}

function toFormSubmission(row: DbFormSubmission): FormSubmission {
  return {
    id: row.id,
    formId: row.formId,
    data: row.data,
    status: row.status as FormSubmissionStatus,
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

  const object = await c.env.MEDIA_BUCKET.get(attachment.key);
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

formsRoute.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/submissions/{submissionId}/replies',
    tags: ['Forms'],
    summary: 'Send a reply to a submission by email',
    description:
      "Sends through this deployment's configured email provider, with Reply-To set to the " +
      "sending staff member's own email so a further reply from the visitor lands in their " +
      'real inbox. Requires a real EMAIL_PROVIDER to be configured — 400s otherwise.',
    request: {
      params: submissionParamsSchema,
      body: { content: { 'application/json': { schema: createFormSubmissionReplySchema } } },
    },
    responses: {
      201: {
        description: 'The reply was sent and recorded.',
        content: { 'application/json': { schema: formSubmissionReplySchema } },
      },
      400: {
        description: 'This deployment has no email provider configured to send from.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      404: {
        description: 'No form or submission matching those ids.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
      502: {
        description: 'The configured email provider rejected or failed to send the message.',
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

    if (!isEmailProviderConfigured(c.env)) {
      return c.json(
        { error: 'This deployment has no email provider configured — see docs/DEPLOYMENT.md\'s recovery section.' },
        400,
      );
    }

    const { to, subject, bodyHtml: rawBodyHtml } = c.req.valid('json');
    const author = c.get('user');

    // Sanitized BEFORE it's ever sent or persisted — the Admin Tiptap editor is not the only
    // path that can reach this endpoint, and the persisted value is later rendered with
    // dangerouslySetInnerHTML for every role with Forms/Submissions access. A strict allow-list
    // (apps/api/src/lib/html-sanitizer.ts) strips anything outside a small set of formatting
    // tags and rejects javascript:/data:/vbscript: (and any other non-http(s)/mailto) URLs on
    // links, regardless of what the client sent.
    const bodyHtml = sanitizeReplyHtml(rawBodyHtml);

    try {
      await getEmailSender(c.env).send({
        to,
        subject,
        html: bodyHtml,
        text: htmlToPlainText(bodyHtml),
        replyTo: author.email,
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
    });
    await recordAudit(db, {
      actorUserId: author.id,
      action: 'form_submission.replied',
      targetType: 'form_submission',
      targetId: submission.id,
      metadata: { formId: id, to, subject },
    });
    // authorName isn't on SessionUser (only id/email/role/disabled) — the client already knows
    // its own signed-in user's display name from the session it's holding, so there's no need
    // for an extra DB read here just to echo it back.
    return c.json(toFormSubmissionReply({ ...reply, authorName: null }), 201);
  },
);

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

    await deleteFormSubmission(db, submissionId);
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
