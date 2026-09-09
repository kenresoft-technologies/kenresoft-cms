import type { Hono } from 'hono';
import type { z } from 'zod';

import type { PluginBindings, PluginContext, PluginPublicVariables, PluginVariables } from './context';
import type { PluginManifest } from './manifest';

// Declared for type-safety/future-proofing only — Phase 1 does not trigger onEnable at runtime;
// there's no clean per-Worker-request moment to run an "install" step safely on Cloudflare
// Workers (docs/PLUGINS.md).
export interface PluginHooks {
  onEnable?(ctx: Pick<PluginContext, 'pluginId' | 'logger'>): void | Promise<void>;
}

// A generic, per-plugin declaration of a tighter rate limit on one sub-path of its own public
// mount, layered on top of (not instead of) the generic publicContentRateLimit every public
// mount already gets. Deliberately names nothing plugin-specific — apps/api/src/plugins/mount.ts
// applies these purely off `pathPrefix`/`bindingName`, so any future plugin can declare its own
// rules the same way without Core ever hardcoding a plugin by name (docs/PLUGINS.md).
export interface PluginPublicRateLimitRule {
  // Relative to this plugin's own public mount, e.g. '/customer-auth' — matched as `${prefix}/*`.
  pathPrefix: string;
  // The exact wrangler.toml [[ratelimits]] binding name to enforce against that sub-path.
  bindingName: string;
}

// The code-level object apps/api/src/plugins/registered-plugins.ts imports — a manifest alone is
// just data; this pairs it with the actual Hono sub-app(s) (mounted by
// apps/api/src/plugins/mount.ts) and the plugin's optional config schema/lifecycle hooks.
export interface PluginRegistration<TConfig = unknown> {
  manifest: PluginManifest;
  routes: Hono<{ Bindings: PluginBindings; Variables: PluginVariables }>;
  // Optional unauthenticated, storefront-facing routes — mounted at
  // /api/plugins/<id>/public/v1/*, with no requireSession, gated only by the same live
  // enablement check the admin mount uses plus Core's public-content rate limiter (Commerce is
  // the first plugin needing this; docs/PLUGINS.md).
  publicRoutes?: Hono<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>;
  // Additional, tighter rate limits on specific sub-paths of publicRoutes — see
  // PluginPublicRateLimitRule. Optional; most plugins need only the generic limiter every public
  // mount already gets.
  publicRateLimits?: PluginPublicRateLimitRule[];
  configSchema?: z.ZodType<TConfig>;
  hooks?: PluginHooks;
}
