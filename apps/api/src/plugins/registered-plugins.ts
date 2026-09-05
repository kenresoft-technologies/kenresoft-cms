import { commercePlugin } from '@kenresoft-cms/plugin-ecommerce';
import { helloPlugin } from '@kenresoft-cms/plugin-hello';
import type { PluginRegistration } from '@kenresoft-cms/plugin-sdk';

// The *only* file in apps/api that imports a plugin package directly — every other Core file
// (index.ts included) only ever imports from ./plugins/*, never a specific plugin, so Core never
// accumulates a hard-coded dependency on plugin business logic (docs/PLUGINS.md).
export const AVAILABLE_PLUGINS: PluginRegistration[] = [helloPlugin, commercePlugin];
