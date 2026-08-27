import { createRoute } from '@hono/zod-openapi';
import { dashboardStatsSchema } from '@kenresoft/contracts';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import { getDashboardStats } from '../../repositories/dashboard';

export const dashboardRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

dashboardRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Dashboard'],
    summary: 'Aggregate dashboard statistics',
    responses: {
      200: {
        description: 'Content-type, entry, and media counts plus recent activity.',
        content: { 'application/json': { schema: dashboardStatsSchema } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    return c.json(await getDashboardStats(db));
  },
);
