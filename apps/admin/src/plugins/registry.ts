import { Puzzle } from 'lucide-react';
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
}

export const pluginNavItems: PluginNavItem[] = [
  { pluginId: 'hello', to: '/plugins/hello', label: 'Hello', end: false, icon: Puzzle },
];

export const pluginRoutes = [
  {
    path: 'plugins/hello',
    lazy: async () => ({ Component: (await import('./hello/HelloPage')).HelloPage }),
  },
];
