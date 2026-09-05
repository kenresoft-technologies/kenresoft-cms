import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginRegistration, PluginVariables } from '@kenresoft-cms/plugin-sdk';

import { commerceConfigSchema } from './config-schema';
import type { CommerceConfig } from './config-schema';
import { commerceManifest } from './manifest';
import { categoriesRoutes } from './routes/categories';
import { productsRoutes } from './routes/products';
import { publicCommerceRoutes } from './routes/public';
import { settingsRoutes } from './routes/settings';

// The admin (session-gated) route tree — /categories, /products, and /settings mounted under
// one parent app, matching how Core's own index.ts composes multiple resource route files.
const routes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginVariables }>();
routes.route('/categories', categoriesRoutes);
routes.route('/products', productsRoutes);
routes.route('/settings', settingsRoutes);

export const commercePlugin: PluginRegistration<CommerceConfig> = {
  manifest: commerceManifest,
  routes,
  publicRoutes: publicCommerceRoutes,
  configSchema: commerceConfigSchema,
};

export { commerceManifest } from './manifest';
export { commerceConfigSchema } from './config-schema';
export type { CommerceConfig } from './config-schema';
