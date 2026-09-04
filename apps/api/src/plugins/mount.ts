import type { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';
import type { PluginBindings, PluginVariables } from '@kenresoft-cms/plugin-sdk';

import { requireSession } from '../middleware/require-session';
import type { Bindings } from '../lib/env';
import type { AuthedVariables } from '../middleware/require-session';
import { createPluginContextMiddleware } from './context';
import { ENABLED_PLUGINS } from './registry';

// The one composition point index.ts calls — index.ts itself never imports a specific plugin
// package, only this (docs/PLUGINS.md). Each enabled plugin is mounted at
// /api/plugins/<id>/v1/*, gated by the exact same requireSession Core already uses for
// /api/v1/admin/*, since a plugin route needs a real session for its PluginContext.user just
// like an admin route does. Finer-grained gating (e.g. editor-only) is applied inline, per
// endpoint, inside the plugin's own routes — see @kenresoft-cms/plugin-sdk's requirePluginRole.
export function mountPlugins(app: OpenAPIHono<{ Bindings: Bindings; Variables: AuthedVariables }>): void {
  for (const plugin of ENABLED_PLUGINS) {
    const base = `/api/plugins/${plugin.manifest.id}/v1`;
    app.use(`${base}/*`, requireSession);

    // Hono composes matched handlers for a request in registration order — a plugin's own
    // .openapi() routes are already registered on `plugin.routes` by the time this file ever
    // sees it (side effect of importing the plugin package), so calling
    // `plugin.routes.use('*', ...)` here would register the context middleware AFTER those
    // routes and it would never actually run before them. A fresh wrapper app, with the
    // middleware registered first and the plugin's routes mounted onto it second, guarantees
    // the correct order regardless of when the plugin itself registered its routes.
    const pluginApp = new Hono<{ Bindings: PluginBindings; Variables: PluginVariables }>();
    pluginApp.use('*', createPluginContextMiddleware(plugin));
    pluginApp.route('/', plugin.routes);

    app.route(base, pluginApp);
  }
}
