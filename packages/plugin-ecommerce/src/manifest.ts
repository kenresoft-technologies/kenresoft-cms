import { PLUGIN_SDK_VERSION } from '@kenresoft-cms/plugin-sdk';
import type { PluginManifest } from '@kenresoft-cms/plugin-sdk';

// Phase 2a (catalog: products/variants/categories/images) + Phase 2b (cart & customer accounts)
// + Phase 2c (checkout & orders) + Phase 2d (payments/Paystack). Storefront integration into
// @kenresoft-cms/astro/examples/astro-site (2e) is the one remaining future pass
// (docs/PLUGINS.md's Commerce section).
export const commerceManifest: PluginManifest = {
  id: 'commerce',
  name: 'Commerce',
  description: 'Product catalog, shopping cart, checkout, orders, and payments.',
  version: '0.4.0',
  sdkVersion: PLUGIN_SDK_VERSION,
  capabilities: ['database', 'media', 'events', 'email', 'payments'],
  permissions: ['commerce:products:manage', 'commerce:categories:manage', 'commerce:customers:manage'],
};
