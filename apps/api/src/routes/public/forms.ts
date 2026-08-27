import { z } from '@hono/zod-openapi';
import { formSubmissionSchema } from '@kenresoft/contracts';
import type { FormSubmission, FormSubmissionStatus } from '@kenresoft/contracts';

import { getDb } from '../../lib/db';
import { validateSubmission } from '../../lib/form-submission-validation';
import { createOpenApiApp } from '../../lib/openapi';
import type { Bindings } from '../../lib/env';
import { listFormFields } from '../../repositories/form-fields';
import { createFormSubmission } from '../../repositories/form-submissions';
import { getFormBySlug } from '../../repositories/forms';
import type { FormSubmission as DbFormSubmission } from '@kenresoft/database';

export const publicFormsRoute = createOpenApiApp<{ Bindings: Bindings }>();

function toFormSubmission(row: DbFormSubmission): FormSubmission {
  return {
    id: row.id,
    formId: row.formId,
    data: row.data,
    status: row.status as FormSubmissionStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

// The valid request body shape is dynamic — determined per-form by that form's own field
// definitions (validateSubmission(), built from FormField rows fetched at request time), not
// knowable at route-definition time the way every other request schema in this API is. Stays
// a plain (non-.openapi()) route; registered with the registry below purely so it still shows
// up in the generated doc.
publicFormsRoute.post('/:slug/submissions', async (c) => {
  const db = getDb(c);
  const form = await getFormBySlug(db, c.req.param('slug'));
  if (!form) {
    return c.json({ error: 'Form not found' }, 404);
  }

  // Rate limited per client IP (§9) — CF-Connecting-IP is set by Cloudflare's edge and can't
  // be spoofed by the client; falls back to a shared key in local dev, where that header
  // usually isn't present.
  const rateLimitKey = c.req.header('CF-Connecting-IP') ?? 'local-dev';
  const { success } = await c.env.FORM_SUBMISSION_RATE_LIMITER.limit({ key: rateLimitKey });
  if (!success) {
    return c.json({ error: 'Too many submissions, please try again later' }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const fields = await listFormFields(db, form.id);
  const validated = validateSubmission(fields, body);
  if (validated.issues) {
    return c.json({ error: 'Validation failed', issues: validated.issues }, 400);
  }

  const submission = await createFormSubmission(db, { formId: form.id, data: validated.data! });
  return c.json(toFormSubmission(submission), 201);
});

publicFormsRoute.openAPIRegistry.registerPath({
  method: 'post',
  path: '/{slug}/submissions',
  tags: ['Public forms'],
  summary: 'Submit a public form',
  description:
    "The request body's valid shape varies per form, built dynamically from that form's own " +
    'field definitions — there is no fixed schema. Rate limited per client IP (5/60s).',
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } },
  },
  responses: {
    201: {
      description: 'The created submission.',
      content: { 'application/json': { schema: formSubmissionSchema } },
    },
    400: {
      description: 'Malformed JSON, or the body failed the form-specific validation.',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'No form with that slug.',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limit exceeded for this client.',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
});
