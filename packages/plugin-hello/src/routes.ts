import { createRoute, z } from '@hono/zod-openapi';
import { createPluginOpenApiApp, requirePluginRole } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginVariables } from '@kenresoft-cms/plugin-sdk';

import type { HelloConfig } from './config-schema';
import { createGreeting, listGreetings } from './repository';

export const helloRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginVariables }>();

const greetingSchema = z.object({ id: z.string(), message: z.string(), createdAt: z.string() });
const createGreetingSchema = z.object({ message: z.string().min(1) });

// Unauthenticated within the plugin mount itself, matching the acceptance test in
// docs/PLUGINS.md verbatim — apps/api/src/plugins/mount.ts still applies requireSession to the
// whole /api/plugins/hello/v1/* prefix, so this is "any authed user," not truly public.
helloRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/hello',
    tags: ['Hello'],
    summary: 'Health check for the hello plugin',
    responses: {
      200: {
        description: 'Confirms the hello plugin is mounted and reachable.',
        content: {
          'application/json': { schema: z.object({ plugin: z.literal('hello'), status: z.literal('ok') }) },
        },
      },
    },
  }),
  (c) => c.json({ plugin: 'hello' as const, status: 'ok' as const }, 200),
);

helloRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/greetings',
    tags: ['Hello'],
    summary: 'List every greeting created through this plugin',
    responses: {
      200: {
        description: 'Every greeting, newest first.',
        content: { 'application/json': { schema: z.array(greetingSchema) } },
      },
    },
  }),
  async (c) => {
    const ctx = c.get('pluginContext');
    const rows = await listGreetings(ctx.db);
    return c.json(
      rows.map((row) => ({ id: row.id, message: row.message, createdAt: row.createdAt.toISOString() })),
      200,
    );
  },
);

helloRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/greetings',
    tags: ['Hello'],
    summary: 'Create a greeting (editor and above)',
    middleware: requirePluginRole('editor'),
    request: {
      body: { content: { 'application/json': { schema: createGreetingSchema } } },
    },
    responses: {
      201: {
        description: "The created greeting, prefixed with this deployment's configured greeting.",
        content: { 'application/json': { schema: greetingSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const ctx = c.get('pluginContext');
    // Already validated against helloConfigSchema by apps/api/src/plugins/context.ts's
    // createPluginConfigService before this ever reaches a route handler — trusted, not
    // re-parsed here.
    const config = (await ctx.config.get()) as HelloConfig;

    const row = await createGreeting(ctx.db, `${config.greeting}, ${input.message}`);
    // Best-effort, in-process only (docs/PLUGINS.md) — nothing here depends on this delivery
    // actually reaching a subscriber.
    ctx.events.emit('hello:greeting.created', { id: row.id, message: row.message });
    ctx.logger.info('Greeting created', { id: row.id });

    return c.json({ id: row.id, message: row.message, createdAt: row.createdAt.toISOString() }, 201);
  },
);
