import type { PluginRegistration } from '@kenresoft-cms/plugin-sdk';

import { helloConfigSchema } from './config-schema';
import type { HelloConfig } from './config-schema';
import { helloManifest } from './manifest';
import { helloRoutes } from './routes';

export const helloPlugin: PluginRegistration<HelloConfig> = {
  manifest: helloManifest,
  routes: helloRoutes,
  configSchema: helloConfigSchema,
};

export { helloManifest } from './manifest';
export { helloConfigSchema } from './config-schema';
export type { HelloConfig } from './config-schema';
