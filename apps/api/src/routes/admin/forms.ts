import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { parseJsonBody } from '../../lib/validate';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import { requireRole } from '../../middleware/require-role';
import { createFormField, listFormFields } from '../../repositories/form-fields';
import {
  getFormSubmissionById,
  listFormSubmissions,
  updateFormSubmissionStatus,
} from '../../repositories/form-submissions';
import { createForm, getFormById, listForms } from '../../repositories/forms';
import { createFormFieldSchema } from '../../validators/form-fields';
import { updateFormSubmissionStatusSchema } from '../../validators/form-submissions';
import { createFormSchema } from '../../validators/forms';

export const formsRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

formsRoute.get('/', async (c) => {
  const db = getDb(c);
  return c.json(await listForms(db));
});

// Forms are a top-level structural resource, same as content types (§11) — creating one is
// an owner-level action.
formsRoute.post('/', requireRole('owner'), async (c) => {
  const parsed = await parseJsonBody(c, createFormSchema);
  if ('error' in parsed) return parsed.error;

  const db = getDb(c);
  const form = await createForm(db, parsed.data);
  return c.json(form, 201);
});

formsRoute.get('/:id', async (c) => {
  const db = getDb(c);
  const form = await getFormById(db, c.req.param('id'));
  if (!form) {
    return c.json({ error: 'Form not found' }, 404);
  }
  return c.json(form);
});

formsRoute.get('/:id/fields', async (c) => {
  const db = getDb(c);
  const form = await getFormById(db, c.req.param('id'));
  if (!form) {
    return c.json({ error: 'Form not found' }, 404);
  }
  return c.json(await listFormFields(db, form.id));
});

formsRoute.post('/:id/fields', async (c) => {
  const db = getDb(c);
  const form = await getFormById(db, c.req.param('id'));
  if (!form) {
    return c.json({ error: 'Form not found' }, 404);
  }

  const parsed = await parseJsonBody(c, createFormFieldSchema);
  if ('error' in parsed) return parsed.error;

  const existingFields = await listFormFields(db, form.id);
  const field = await createFormField(db, {
    ...parsed.data,
    formId: form.id,
    sortOrder: parsed.data.sortOrder ?? existingFields.length,
  });
  return c.json(field, 201);
});

formsRoute.get('/:id/submissions', async (c) => {
  const db = getDb(c);
  const form = await getFormById(db, c.req.param('id'));
  if (!form) {
    return c.json({ error: 'Form not found' }, 404);
  }
  return c.json(await listFormSubmissions(db, form.id));
});

// No role gate — triaging submissions (new/read/archived) is an editorial action, same as
// entry create/edit, which also has no server-side role check.
formsRoute.patch('/:id/submissions/:submissionId', async (c) => {
  const db = getDb(c);
  const form = await getFormById(db, c.req.param('id'));
  if (!form) {
    return c.json({ error: 'Form not found' }, 404);
  }

  const submission = await getFormSubmissionById(db, c.req.param('submissionId'));
  if (!submission || submission.formId !== form.id) {
    return c.json({ error: 'Submission not found' }, 404);
  }

  const parsed = await parseJsonBody(c, updateFormSubmissionStatusSchema);
  if ('error' in parsed) return parsed.error;

  const updated = await updateFormSubmissionStatus(db, submission.id, parsed.data.status);
  return c.json(updated);
});
