import { PLUGIN_SDK_VERSION } from '@kenresoft-cms/plugin-sdk';
import type { PluginManifest } from '@kenresoft-cms/plugin-sdk';

// Phase 2a (catalog: products/variants/categories/images) + Phase 2b (cart & customer accounts).
// Checkout/orders and payments/Paystack are deliberately not part of this manifest yet; each is
// a separate future pass (docs/PLUGINS.md's Commerce section).
export const commerceManifest: PluginManifest = {
  id: 'commerce',
  name: 'Commerce',
  description: 'Product catalog, shopping cart, and customer accounts.',
  version: '0.2.0',
  sdkVersion: PLUGIN_SDK_VERSION,
  capabilities: ['database', 'media', 'events', 'email'],
  permissions: ['commerce:products:manage', 'commerce:categories:manage', 'commerce:customers:manage'],
};
