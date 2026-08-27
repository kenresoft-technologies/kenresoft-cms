import { createRoute } from '@hono/zod-openapi';
import { formSubmissionWithFormSchema } from '@kenresoft/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { listSubmissionsWithForm } from '../../repositories/form-submissions';
import { toFormSubmissionWithForm } from './forms';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const submissionsRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

// Unified admin "all submissions" view across every form, mirroring GET /api/v1/admin/entries'
// contentTypeId-omitted branch — a separate top-level route rather than an optional query
// param on /forms/{id}/submissions, since that path already uses {id} as the form id in a
// path segment, not a query string.
submissionsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Forms'],
    summary: 'List every submission across every form',
    responses: {
      200: {
        description: 'Every submission across every form, newest first, each with its form joined in.',
        content: { 'application/json': { schema: z.array(formSubmissionWithFormSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const rows = await listSubmissionsWithForm(db);
    return c.json(rows.map(toFormSubmissionWithForm), 200);
  },
);
