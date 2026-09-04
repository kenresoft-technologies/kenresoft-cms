import { PLUGIN_SDK_VERSION } from '@kenresoft-cms/plugin-sdk';
import type { PluginManifest } from '@kenresoft-cms/plugin-sdk';

// The Phase 1 plugin-platform proof-of-concept (docs/PLUGINS.md §"Hello World acceptance
// test") — deliberately trivial, demonstrating every extension point (migration, API route,
// admin nav/page, permission, config, event) without any real domain logic.
export const helloManifest: PluginManifest = {
  id: 'hello',
  name: 'Hello',
  version: '0.1.0',
  sdkVersion: PLUGIN_SDK_VERSION,
  capabilities: ['database', 'events'],
  permissions: ['hello:greeting:create'],
};
