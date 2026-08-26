import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { validateSubmission } from '../../lib/form-submission-validation';
import type { Bindings } from '../../lib/env';
import { listFormFields } from '../../repositories/form-fields';
import { createFormSubmission } from '../../repositories/form-submissions';
import { getFormBySlug } from '../../repositories/forms';

export const publicFormsRoute = new Hono<{ Bindings: Bindings }>();

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
  return c.json(submission, 201);
});
