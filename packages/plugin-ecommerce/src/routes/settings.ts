import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp, requirePluginRole } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginVariables } from '@kenresoft-cms/plugin-sdk';

import type { CommerceConfig } from '../config-schema';

// The first plugin route exposing PluginContext.config over HTTP — Phase 1's Hello demo only
// ever read/wrote config server-side (never via a route), so this is a small, real addition:
// an admin settings UI needs somewhere to GET the current value and PUT a new one.
export const settingsRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginVariables }>();

const configSchema = z.object({
  storeName: z.string().min(1),
  defaultCurrency: z.string().length(3),
});

settingsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Commerce Settings'],
    summary: 'Get the commerce plugin config',
    responses: {
      200: { description: 'The current config.', content: { 'application/json': { schema: configSchema } } },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const config = (await ctx.config.get()) as CommerceConfig;
    return c.json(config, 200);
  },
);

settingsRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/',
    tags: ['Commerce Settings'],
    summary: 'Update the commerce plugin config (editor and above)',
    middleware: requirePluginRole('editor'),
    request: { body: { content: { 'application/json': { schema: configSchema } } } },
    responses: {
      200: { description: 'The updated config.', content: { 'application/json': { schema: configSchema } } },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');
    await ctx.config.set(input);
    return c.json(input, 200);
  },
);
