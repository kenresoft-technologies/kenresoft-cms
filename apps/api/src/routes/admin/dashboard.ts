import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import { getDashboardStats } from '../../repositories/dashboard';

export const dashboardRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

dashboardRoute.get('/', async (c) => {
  const db = getDb(c);
  return c.json(await getDashboardStats(db));
});
