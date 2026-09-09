import { PLUGIN_SDK_VERSION, pluginManifestSchema } from '@kenresoft-cms/plugin-sdk';
import type { PluginRegistration } from '@kenresoft-cms/plugin-sdk';

import { AVAILABLE_PLUGINS } from './registered-plugins';

export class PluginRegistryError extends Error {}

function validateManifest(registration: PluginRegistration): void {
  const parsed = pluginManifestSchema.safeParse(registration.manifest);
  if (!parsed.success) {
    throw new PluginRegistryError(
      `Plugin "${registration.manifest.id}" has a malformed manifest: ${parsed.error.message}`,
    );
  }
  if (registration.manifest.sdkVersion !== PLUGIN_SDK_VERSION) {
    throw new PluginRegistryError(
      `Plugin "${registration.manifest.id}" declares sdkVersion "${registration.manifest.sdkVersion}", ` +
        `but this deployment's plugin SDK is "${PLUGIN_SDK_VERSION}".`,
    );
  }
}

// Pure and side-effect-free (no reliance on the real static plugin list) specifically so
// apps/api/test/plugin-registry.test.ts can exercise every failure mode against a throwaway,
// fabricated plugin list — never the real @kenresoft-cms/plugin-hello import. Validates every
// AVAILABLE plugin's manifest shape/sdkVersion/duplicate-ids — everything that can be decided at
// Worker cold-start, before any request (and therefore any D1 binding) exists. Whether a
// validated plugin is actually *enabled* is a separate, per-request, DB-backed question (see
// ./enablement.ts) — that can change without a redeploy, so it can't be resolved this early.
// docs/PLUGINS.md.
export function validatePlugins(available: PluginRegistration[]): PluginRegistration[] {
  const seenIds = new Set<string>();
  for (const registration of available) {
    validateManifest(registration);
    if (seenIds.has(registration.manifest.id)) {
      throw new PluginRegistryError(`Duplicate plugin id "${registration.manifest.id}"`);
    }
    seenIds.add(registration.manifest.id);
  }
  return available;
}

// Runs once at Worker module-load (cold start) — any failure throws here, not per-request, so a
// misconfigured plugin fails clearly at startup/deploy time rather than obscurely later
// (docs/PLUGINS.md).
export const VALIDATED_PLUGINS: PluginRegistration[] = validatePlugins(AVAILABLE_PLUGINS);
