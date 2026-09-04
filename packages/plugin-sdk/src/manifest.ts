import { z } from 'zod';

// What a plugin is allowed to integrate with — a separate concept from permissions (which
// govern what *users* can do inside an enabled plugin, docs/PLUGINS.md). Phase 1 validates this
// list for well-formedness only (catches typos); it does not gate what PluginContext exposes at
// runtime — every enabled plugin gets the full context surface regardless of what it declares.
export const PLUGIN_CAPABILITIES = ['database', 'media', 'auth', 'rbac', 'events', 'email', 'storage'] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

// Bumped only when a change to PluginContext/PluginRegistration would break an existing plugin
// (docs/PLUGINS.md). The registry rejects any plugin whose manifest.sdkVersion doesn't match
// this exactly — Phase 1 has exactly one shipped version, so there's nothing to be lenient
// about yet (no semver-range compatibility check).
export const PLUGIN_SDK_VERSION = '1.0.0';

// `<plugin-id>:<resource>:<action>`, e.g. "hello:greeting:create" — a real, namespaced string
// (not an untyped blob) so a future granular permission-enforcement layer can consume this same
// manifest field without a breaking shape change. Phase 1 enforcement itself reuses the existing
// Core role hierarchy (see permissions.ts's requirePluginRole) — this array is documentation/
// discovery metadata only, never itself checked against a request.
const PLUGIN_PERMISSION_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

export const pluginManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'Plugin id must be lowercase, start with a letter, and use only letters/digits/hyphens'),
  name: z.string().min(1),
  // Shown on the admin Plugins page (apps/admin/src/pages/PluginsPage.tsx) — optional since it's
  // purely descriptive, never checked against anything.
  description: z.string().min(1).optional(),
  version: z.string().min(1),
  sdkVersion: z.string().min(1),
  // Other plugin ids this plugin requires to already be enabled — validated by the registry
  // (apps/api/src/plugins/registry.ts) against the set of ENABLED plugins, not just installed
  // ones, so a dependency that's merely present-but-disabled is still caught.
  dependencies: z.record(z.string(), z.string()).optional(),
  capabilities: z.array(z.enum(PLUGIN_CAPABILITIES)).optional(),
  permissions: z.array(z.string().regex(PLUGIN_PERMISSION_PATTERN)).optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
