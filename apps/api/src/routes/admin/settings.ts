import { createRoute } from '@hono/zod-openapi';
import { settingsSchema, upsertSettingsSchema } from '@kenresoft/contracts';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import { getSettings, upsertSettings } from '../../repositories/settings';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

export const settingsRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

settingsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Settings'],
    summary: 'Get the deployment settings',
    responses: {
      200: {
        description: 'The singleton Settings row, or null if never saved.',
        content: { 'application/json': { schema: settingsSchema.nullable() } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const row = await getSettings(db);
    return c.json(row ?? null);
  },
);

// Site-wide configuration is an owner-level action, matching content-type/form creation.
settingsRoute.openapi(
  createRoute({
    method: 'put',
    path: '/',
    tags: ['Settings'],
    summary: 'Update the deployment settings (owner only)',
    middleware: requireRole('admin'),
    request: {
      body: { content: { 'application/json': { schema: upsertSettingsSchema } } },
    },
    responses: {
      200: {
        description: 'The updated Settings row.',
        content: { 'application/json': { schema: settingsSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);
    const row = await upsertSettings(db, input);
    return c.json(row);
  },
);
