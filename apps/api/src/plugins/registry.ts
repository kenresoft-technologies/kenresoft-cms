import { PLUGIN_SDK_VERSION, pluginManifestSchema } from '@kenresoft-cms/plugin-sdk';
import type { PluginRegistration } from '@kenresoft-cms/plugin-sdk';

import { pluginsConfig } from './plugins.config';
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

// Pure and side-effect-free (no reliance on the real static config/plugin list) specifically so
// apps/api/test/plugin-registry.test.ts can exercise every failure mode against a throwaway,
// fabricated plugin list — never the real @kenresoft-cms/plugin-hello import — without needing
// to mutate this module's real exports. Validates every AVAILABLE plugin (not just enabled
// ones) for duplicate ids/malformed shape/unsupported sdkVersion, then resolves which of those
// are actually enabled and checks their declared dependencies are enabled too.
export function resolvePlugins(
  available: PluginRegistration[],
  config: Record<string, { enabled: boolean } | undefined>,
): PluginRegistration[] {
  const seenIds = new Set<string>();
  for (const registration of available) {
    validateManifest(registration);
    if (seenIds.has(registration.manifest.id)) {
      throw new PluginRegistryError(`Duplicate plugin id "${registration.manifest.id}"`);
    }
    seenIds.add(registration.manifest.id);
  }

  const enabled = available.filter((registration) => config[registration.manifest.id]?.enabled === true);

  const enabledIds = new Set(enabled.map((registration) => registration.manifest.id));
  for (const registration of enabled) {
    for (const dependencyId of Object.keys(registration.manifest.dependencies ?? {})) {
      if (!enabledIds.has(dependencyId)) {
        throw new PluginRegistryError(
          `Plugin "${registration.manifest.id}" depends on "${dependencyId}", which is not enabled.`,
        );
      }
    }
  }

  return enabled;
}

// Runs once at Worker module-load (cold start) — any failure throws here, not per-request, so a
// misconfigured plugin fails clearly at startup/deploy time rather than obscurely later
// (docs/PLUGINS.md).
export const ENABLED_PLUGINS: PluginRegistration[] = resolvePlugins(AVAILABLE_PLUGINS, pluginsConfig);
