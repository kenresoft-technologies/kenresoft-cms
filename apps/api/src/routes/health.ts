import { createRoute } from '@hono/zod-openapi';
import { sql } from '@kenresoft/database';
import { healthResponseSchema } from '@kenresoft/contracts';

import { getDb } from '../lib/db';
import { createOpenApiApp } from '../lib/openapi';
import type { Bindings } from '../lib/env';

export const healthRoute = createOpenApiApp<{ Bindings: Bindings }>();

healthRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Health'],
    summary: 'Health check',
    responses: {
      200: {
        description: 'The API and its D1 connection are healthy.',
        content: { 'application/json': { schema: healthResponseSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    await db.run(sql`select 1`);

    return c.json({ status: 'ok' as const, version: c.env.API_VERSION });
  },
);
