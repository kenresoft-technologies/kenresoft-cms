import { createRoute, z } from '@hono/zod-openapi';
import { pluginSummarySchema, updatePluginEnablementSchema } from '@kenresoft-cms/contracts';
import type { PluginSummary } from '@kenresoft-cms/contracts';

import { recordAudit } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { requireRole } from '../../middleware/require-role';
import { VALIDATED_PLUGINS } from '../../plugins/registry';
import { isPluginEnabled, setPluginEnabled } from '../../repositories/plugin-enablement';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';

// Toggling is admin-only (structural/platform-level, matching webhooks.ts's stricter floor) —
// but the list itself is readable by any authenticated user (just requireSession from the
// blanket /api/v1/admin/* middleware, no extra role gate), since apps/admin's nav/command-
// palette need every role to know whether a plugin is currently enabled before rendering its
// links; unlike audit-log.ts, this data isn't sensitive, only the ability to change it is. The
// Plugins admin *page* itself still hides below admin (apps/admin/src/pages/PluginsPage.tsx) —
// there's nothing a lower role could usefully do with it beyond what the nav already reflects.
export const pluginsRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });
const idParamSchema = z.object({ id: z.string().min(1) });

pluginsRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Plugins'],
    summary: 'List every plugin bundled into this deployment',
    responses: {
      200: {
        description: 'Every validated (bundled) plugin, joined with its live enabled state.',
        content: { 'application/json': { schema: z.array(pluginSummarySchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    const summaries: PluginSummary[] = await Promise.all(
      VALIDATED_PLUGINS.map(async (plugin) => ({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        description: plugin.manifest.description ?? null,
        version: plugin.manifest.version,
        enabled: await isPluginEnabled(db, plugin.manifest.id),
      })),
    );
    return c.json(summaries, 200);
  },
);

pluginsRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Plugins'],
    summary: 'Enable or disable a bundled plugin (admin only)',
    middleware: requireRole('admin'),
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updatePluginEnablementSchema } } },
    },
    responses: {
      200: {
        description: 'The plugin, with its updated enabled state. Takes effect immediately, no redeploy.',
        content: { 'application/json': { schema: pluginSummarySchema } },
      },
      404: {
        description: 'No bundled plugin with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    const plugin = VALIDATED_PLUGINS.find((registration) => registration.manifest.id === id);
    if (!plugin) {
      return c.json({ error: 'No bundled plugin with that id' }, 404);
    }

    const db = getDb(c);
    await setPluginEnabled(db, id, enabled);
    await recordAudit(db, {
      actorUserId: c.get('user').id,
      action: enabled ? 'plugin.enabled' : 'plugin.disabled',
      targetType: 'plugin',
      targetId: id,
      metadata: { name: plugin.manifest.name },
    });

    return c.json(
      {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        description: plugin.manifest.description ?? null,
        version: plugin.manifest.version,
        enabled,
      },
      200,
    );
  },
);
