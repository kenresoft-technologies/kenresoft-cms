import type { Hono } from 'hono';
import type { z } from 'zod';

import type { PluginBindings, PluginContext, PluginVariables } from './context';
import type { PluginManifest } from './manifest';

// Declared for type-safety/future-proofing only — Phase 1 does not trigger onEnable at runtime;
// there's no clean per-Worker-request moment to run an "install" step safely on Cloudflare
// Workers (docs/PLUGINS.md).
export interface PluginHooks {
  onEnable?(ctx: Pick<PluginContext, 'pluginId' | 'logger'>): void | Promise<void>;
}

// The code-level object apps/api/src/plugins/registered-plugins.ts imports — a manifest alone is
// just data; this pairs it with the actual Hono sub-app (mounted by
// apps/api/src/plugins/mount.ts) and the plugin's optional config schema/lifecycle hooks.
export interface PluginRegistration<TConfig = unknown> {
  manifest: PluginManifest;
  routes: Hono<{ Bindings: PluginBindings; Variables: PluginVariables }>;
  configSchema?: z.ZodType<TConfig>;
  hooks?: PluginHooks;
}
