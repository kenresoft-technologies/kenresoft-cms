import { createPluginOpenApiApp } from '@kenresoft-cms/plugin-sdk';
import type { PluginBindings, PluginPublicVariables, PluginRegistration, PluginVariables } from '@kenresoft-cms/plugin-sdk';

import { commerceConfigSchema } from './config-schema';
import type { CommerceConfig } from './config-schema';
import { commerceManifest } from './manifest';
import { adminCustomersRoutes } from './routes/admin-customers';
import { adminOrdersRoutes } from './routes/admin-orders';
import { cartRoutes } from './routes/cart';
import { categoriesRoutes } from './routes/categories';
import { checkoutRoutes } from './routes/checkout';
import { customerRoutes } from './routes/customer';
import { customerAuthRoutes } from './routes/customer-auth';
import { paymentsRoutes } from './routes/payments';
import { productsRoutes } from './routes/products';
import { catalogPublicRoutes } from './routes/public';
import { settingsRoutes } from './routes/settings';

// The admin (session-gated) route tree — one parent app, matching how Core's own index.ts
// composes multiple resource route files.
const routes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginVariables }>();
routes.route('/categories', categoriesRoutes);
routes.route('/products', productsRoutes);
routes.route('/settings', settingsRoutes);
routes.route('/customers', adminCustomersRoutes);
routes.route('/orders', adminOrdersRoutes);

// The public (unauthenticated) route tree — catalog reads at root (unchanged URLs from Phase
// 2a), plus Phase 2b's customer-auth/customer/cart sub-trees, Phase 2c's checkout, and Phase 2d's
// payments. customer-auth gets its own, tighter rate limit declared below (publicRateLimits);
// customer/cart/checkout/payments rely on the generic public-content limiter plus their own
// session/cookie/reference-based authorization.
const publicRoutes = createPluginOpenApiApp<{ Bindings: PluginBindings; Variables: PluginPublicVariables }>();
publicRoutes.route('/', catalogPublicRoutes);
publicRoutes.route('/customer-auth', customerAuthRoutes);
publicRoutes.route('/customer', customerRoutes);
publicRoutes.route('/cart', cartRoutes);
publicRoutes.route('/checkout', checkoutRoutes);
publicRoutes.route('/payments', paymentsRoutes);

export const commercePlugin: PluginRegistration<CommerceConfig> = {
  manifest: commerceManifest,
  routes,
  publicRoutes,
  publicRateLimits: [{ pathPrefix: '/customer-auth', bindingName: 'COMMERCE_CUSTOMER_AUTH_RATE_LIMITER' }],
  configSchema: commerceConfigSchema,
};

export { commerceManifest } from './manifest';
export { commerceConfigSchema } from './config-schema';
export type { CommerceConfig } from './config-schema';
