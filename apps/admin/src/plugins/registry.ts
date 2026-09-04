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
  to: string;
  label: string;
  end: boolean;
  icon: LucideIcon;
}

export const pluginNavItems: PluginNavItem[] = [{ to: '/plugins/hello', label: 'Hello', end: false, icon: Puzzle }];

export const pluginRoutes = [
  {
    path: 'plugins/hello',
    lazy: async () => ({ Component: (await import('./hello/HelloPage')).HelloPage }),
  },
];
