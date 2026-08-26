import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { parseJsonBody } from '../../lib/validate';
import { requireRole } from '../../middleware/require-role';
import { getSettings, upsertSettings } from '../../repositories/settings';
import { upsertSettingsSchema } from '../../validators/settings';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const settingsRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

settingsRoute.get('/', async (c) => {
  const db = getDb(c);
  const row = await getSettings(db);
  return c.json(row ?? null);
});

// Site-wide configuration is an owner-level action, matching content-type/form creation.
settingsRoute.put('/', requireRole('owner'), async (c) => {
  const parsed = await parseJsonBody(c, upsertSettingsSchema);
  if ('error' in parsed) return parsed.error;

  const db = getDb(c);
  const row = await upsertSettings(db, parsed.data);
  return c.json(row);
});
