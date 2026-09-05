import type { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';
import type { PluginBindings, PluginPublicVariables, PluginVariables } from '@kenresoft-cms/plugin-sdk';

import { publicContentRateLimit } from '../middleware/public-content-rate-limit';
import { requireSession } from '../middleware/require-session';
import type { Bindings } from '../lib/env';
import type { AuthedVariables } from '../middleware/require-session';
import { createPluginContextMiddleware, createPluginPublicContextMiddleware } from './context';
import { requirePluginEnabled } from './enablement';
import { VALIDATED_PLUGINS } from './registry';

// The one composition point index.ts calls — index.ts itself never imports a specific plugin
// package, only this (docs/PLUGINS.md). Every VALIDATED plugin (manifest-correct, not
// necessarily currently enabled) is mounted at /api/plugins/<id>/v1/* — Hono's route composition
// is static/cheap, so mounting happens unconditionally at cold start; actual request handling is
// gated per-request by requirePluginEnabled (a live, DB-backed check, checked before
// requireSession so a disabled plugin 404s regardless of auth state). Finer-grained gating
// (e.g. editor-only) is applied inline, per endpoint, inside the plugin's own routes — see
// @kenresoft-cms/plugin-sdk's requirePluginRole.
export function mountPlugins(app: OpenAPIHono<{ Bindings: Bindings; Variables: AuthedVariables }>): void {
  for (const plugin of VALIDATED_PLUGINS) {
    const base = `/api/plugins/${plugin.manifest.id}/v1`;
    app.use(`${base}/*`, requirePluginEnabled(plugin.manifest.id));
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

    // Optional unauthenticated, storefront-facing mount (Commerce is the first plugin needing
    // this) — mirrors Core's own /api/v1/public/* vs /api/v1/admin/* split. Gated by the same
    // live requirePluginEnabled check as the admin mount (a disabled plugin's storefront API
    // must 404 too, not just its admin API) plus Core's existing public-content rate limiter,
    // reused as-is rather than a new binding — but deliberately never requireSession.
    if (plugin.publicRoutes) {
      const publicBase = `/api/plugins/${plugin.manifest.id}/public/v1`;
      app.use(`${publicBase}/*`, requirePluginEnabled(plugin.manifest.id));
      app.use(`${publicBase}/*`, publicContentRateLimit);

      const publicPluginApp = new Hono<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();
      publicPluginApp.use('*', createPluginPublicContextMiddleware(plugin));
      publicPluginApp.route('/', plugin.publicRoutes);

      app.route(publicBase, publicPluginApp);
    }
  }
}
