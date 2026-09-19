import { createRoute } from '@hono/zod-openapi';
import { settingsSchema, upsertSettingsSchema } from '@kenresoft-cms/contracts';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { recordAudit } from '../../lib/audit';
import { invalidateAllPageCaches } from '../../lib/page-cache';
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

// Site-wide configuration is an admin-level action, matching content-type/form creation.
settingsRoute.openapi(
  createRoute({
    method: 'put',
    path: '/',
    tags: ['Settings'],
    summary: 'Update the deployment settings (admin only)',
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
    const before = await getSettings(db);
    const row = await upsertSettings(db, input);

    // Turning Raw HTML blocks on or off is a security-relevant switch: record who did it, and
    // purge cached public pages so the change (especially switching OFF) takes effect at once.
    const wasOn = before?.featureFlags?.['rawHtmlBlocks'] === true;
    const isOn = row.featureFlags?.['rawHtmlBlocks'] === true;
    if (wasOn !== isOn) {
      await recordAudit(db, {
        actorUserId: c.get('user').id,
        action: isOn ? 'settings.raw_html_enabled' : 'settings.raw_html_disabled',
        targetType: 'settings',
        targetId: row.id,
      });
      c.executionCtx.waitUntil(invalidateAllPageCaches(db));
    }
    return c.json(row);
  },
);
