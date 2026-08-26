import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from '../lib/db';
import type { Bindings } from '../lib/env';

export const healthRoute = new Hono<{ Bindings: Bindings }>();

healthRoute.get('/', async (c) => {
  const db = getDb(c);
  await db.run(sql`select 1`);

  return c.json({
    status: 'ok',
    version: c.env.API_VERSION,
  });
});
