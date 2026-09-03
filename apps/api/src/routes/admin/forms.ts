import { createRoute } from '@hono/zod-openapi';
import {
  createFormFieldSchema,
  createFormSchema,
  formFieldSchema,
  formSchema,
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
  FormSubmissionStatus,
  FormSubmissionWithForm,
} from '@kenresoft-cms/contracts';
import { z } from 'zod';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import {
  createFormField,
  deleteFormField,
  getFormFieldById,
  listFormFields,
  updateFormField,
} from '../../repositories/form-fields';
import {
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
} from '@kenresoft-cms/database';

export const formsRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });
const submissionParamsSchema = z.object({ id: z.string().min(1), submissionId: z.string().min(1) });
const fieldParamSchema = z.object({ id: z.string().min(1), fieldId: z.string().min(1) });

function toForm(row: DbForm): Form {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
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
