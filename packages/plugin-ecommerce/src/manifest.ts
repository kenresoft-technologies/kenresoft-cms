import { PLUGIN_SDK_VERSION } from '@kenresoft-cms/plugin-sdk';
import type { PluginManifest } from '@kenresoft-cms/plugin-sdk';

// Phase 2a — the catalog domain only (products, variants, categories, images). Cart,
// checkout/orders, and payments/Paystack are deliberately not part of this manifest yet; each is
// a separate future pass (docs/PLUGINS.md's Commerce section).
export const commerceManifest: PluginManifest = {
  id: 'commerce',
  name: 'Commerce',
  description: 'Product catalog: products, variants, categories, and images.',
  version: '0.1.0',
  sdkVersion: PLUGIN_SDK_VERSION,
  capabilities: ['database', 'media', 'events'],
  permissions: ['commerce:products:manage', 'commerce:categories:manage'],
};
