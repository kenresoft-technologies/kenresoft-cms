import type { MiddlewareHandler } from 'hono';
import type { Database } from '@kenresoft-cms/database';
import type { PluginRegistration } from '@kenresoft-cms/plugin-sdk';

import { getDb } from '../lib/db';
import { isPluginEnabled } from '../repositories/plugin-enablement';
import type { Bindings } from '../lib/env';
import type { AuthedVariables } from '../middleware/require-session';
import { VALIDATED_PLUGINS } from './registry';

// Whether a plugin is currently usable: it must itself be enabled, and every plugin it declares
// as a dependency (manifest.dependencies) must also currently be enabled — Phase 1's static
// "dependency must be enabled" check, adapted to per-request DB-backed enablement. `plugins`
// defaults to the real VALIDATED_PLUGINS but takes an explicit list so
// apps/api/test/plugin-enablement.test.ts can exercise the dependency branch against a
// fabricated plugin list, the same way registry.ts's validatePlugins is tested.
export async function checkPluginEnablement(
  db: Database,
  pluginId: string,
  plugins: PluginRegistration[] = VALIDATED_PLUGINS,
): Promise<boolean> {
  if (!(await isPluginEnabled(db, pluginId))) {
    return false;
  }

  const plugin = plugins.find((registration) => registration.manifest.id === pluginId);
  for (const dependencyId of Object.keys(plugin?.manifest.dependencies ?? {})) {
    if (!(await isPluginEnabled(db, dependencyId))) {
      return false;
    }
  }

  return true;
}

// Checked before requireSession (apps/api/src/plugins/mount.ts) so a disabled plugin 404s
// unconditionally, regardless of auth state — matching the "disabled/unconfigured is
// indistinguishable from not installed" convention this codebase already uses for the
// break-glass owner-recovery route (routes/system/recover-owner.ts).
export function requirePluginEnabled(
  pluginId: string,
): MiddlewareHandler<{ Bindings: Bindings; Variables: AuthedVariables }> {
  return async (c, next) => {
    const db = getDb(c);
    if (!(await checkPluginEnablement(db, pluginId))) {
      return c.json({ error: 'Not found' }, 404);
    }
    await next();
  };
}
