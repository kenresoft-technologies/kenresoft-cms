import { FolderTree, Package, Puzzle, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// The one place both AppLayout's sidebar and command-palette read plugin nav entries from —
// mirrors the flat-typed-array pattern apps/admin/src/pages/settings/sections.tsx already uses
// for Settings' own extension points (docs/PLUGINS.md). A plugin's admin nav entry/page lives
// here, in apps/admin, not inside its server-side packages/plugin-<id> package — see
// docs/PLUGINS.md's admin-composition note for why (keeps apps/admin's standalone-clone
// property, and its published-semver @kenresoft-cms/contracts dependency, intact — no plugin
// package ever becomes a required workspace:* dependency of this app).
export interface PluginNavItem {
  // Matches the plugin's manifest id (packages/plugin-<id>/src/manifest.ts) — AppLayout/
  // command-palette check this against the live GET /api/v1/admin/plugins list before
  // rendering, so a disabled plugin's link disappears instead of just 404ing when clicked.
  pluginId: string;
  to: string;
  label: string;
  end: boolean;
  icon: LucideIcon;
  // Groups related nav items under one SidebarGroupLabel (AppLayout.tsx renders one group per
  // distinct value) — defaults to "Plugins" when omitted, so a single-page plugin like Hello
  // doesn't need one, but a multi-page plugin (Commerce) can have its own labeled group instead
  // of piling up in the shared one.
  group?: string;
}

export const pluginNavItems: PluginNavItem[] = [
  { pluginId: 'hello', to: '/plugins/hello', label: 'Hello', end: false, icon: Puzzle },
  {
    pluginId: 'commerce',
    to: '/plugins/commerce/products',
    label: 'Products',
    end: false,
    icon: Package,
    group: 'Commerce',
  },
  {
    pluginId: 'commerce',
    to: '/plugins/commerce/categories',
    label: 'Categories',
    end: false,
    icon: FolderTree,
    group: 'Commerce',
  },
  {
    pluginId: 'commerce',
    to: '/plugins/commerce/settings',
    label: 'Settings',
    end: false,
    icon: Settings,
    group: 'Commerce',
  },
];

export const pluginRoutes = [
  {
    path: 'plugins/hello',
    lazy: async () => ({ Component: (await import('./hello/HelloPage')).HelloPage }),
  },
  {
    path: 'plugins/commerce/products',
    lazy: async () => ({ Component: (await import('./commerce/ProductsPage')).ProductsPage }),
  },
  {
    path: 'plugins/commerce/products/:productId',
    lazy: async () => ({ Component: (await import('./commerce/ProductDetailPage')).ProductDetailPage }),
  },
  {
    path: 'plugins/commerce/categories',
    lazy: async () => ({ Component: (await import('./commerce/CategoriesPage')).CategoriesPage }),
  },
  {
    path: 'plugins/commerce/settings',
    lazy: async () => ({ Component: (await import('./commerce/SettingsPage')).CommerceSettingsPage }),
  },
];
