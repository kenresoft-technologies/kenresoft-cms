import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Database,
  HardDrive,
  Palette,
  Plug,
  Settings2,
  Share2,
  Shield,
  SlidersHorizontal,
  Trash2,
  UserCog,
  Webhook,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { Settings } from '@/lib/types';
import { AdvancedSection } from './AdvancedSection';
import { ApiSection } from './ApiSection';
import { AppearanceSection } from './AppearanceSection';
import { CacheSection } from './CacheSection';
import { ComingSoonSection } from './ComingSoonSection';
import { GeneralSection } from './GeneralSection';
import { SocialSection } from './SocialSection';
import { UsersPermissionsSection } from './UsersPermissionsSection';
import { WebhooksSection } from './WebhooksSection';

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'security'
  | 'notifications'
  | 'social'
  | 'storage'
  | 'database'
  | 'api'
  | 'cache'
  | 'users'
  | 'webhooks'
  | 'advanced';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  available: boolean;
  render: (props: { settings: Settings | null; readOnly: boolean }) => ReactNode;
}

// One registry drives both the left nav and the content pane, so adding a future section (once
// its backend exists) is a single entry here instead of touching nav + routing + content
// switch separately. `available: false` entries render ComingSoonSection — the IA exists, the
// functionality doesn't, and the UI says so rather than faking it.
export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  {
    id: 'general',
    label: 'General',
    icon: Settings2,
    available: true,
    render: ({ settings, readOnly }) => <GeneralSection settings={settings} readOnly={readOnly} />,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    available: true,
    render: () => <AppearanceSection />,
  },
  {
    id: 'security',
    label: 'Security',
    icon: Shield,
    available: false,
    render: () => (
      <ComingSoonSection
        title="Security"
        icon={Shield}
        description="Deployment-wide authentication policy. Two-factor authentication and active session management are already available per-account on your Profile page (top-right menu → Profile → Security)."
        planned={['Password policy controls', 'Requiring two-factor authentication for admin/owner accounts']}
      />
    ),
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    available: false,
    render: () => (
      <ComingSoonSection
        title="Notifications"
        icon={Bell}
        description="Email alerts for activity on this deployment."
        planned={['New form submission alerts', 'Scheduled-publish confirmations', 'Admin digest emails']}
      />
    ),
  },
  {
    id: 'social',
    label: 'Social & contact',
    icon: Share2,
    available: true,
    render: () => <SocialSection />,
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: HardDrive,
    available: false,
    render: () => (
      <ComingSoonSection
        title="Storage"
        icon={HardDrive}
        description="Media storage limits and usage for this deployment's R2 bucket."
        planned={['Per-upload size limits', 'Storage usage and quota', 'Allowed file types']}
      />
    ),
  },
  {
    id: 'database',
    label: 'Database',
    icon: Database,
    available: false,
    render: () => (
      <ComingSoonSection
        title="Database"
        icon={Database}
        description="D1 database status and maintenance for this deployment."
        planned={['Backup and export', 'Migration history', 'Storage usage']}
      />
    ),
  },
  {
    id: 'api',
    label: 'API',
    icon: Plug,
    available: true,
    render: ({ settings, readOnly }) => <ApiSection settings={settings} readOnly={readOnly} />,
  },
  {
    id: 'cache',
    label: 'Cache',
    icon: Trash2,
    available: true,
    render: ({ readOnly }) => <CacheSection readOnly={readOnly} />,
  },
  {
    id: 'users',
    label: 'Users & Permissions',
    icon: UserCog,
    available: true,
    render: () => <UsersPermissionsSection />,
  },
  {
    id: 'webhooks',
    label: 'Webhooks',
    icon: Webhook,
    available: true,
    render: () => <WebhooksSection />,
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: SlidersHorizontal,
    available: true,
    render: ({ settings, readOnly }) => <AdvancedSection settings={settings} readOnly={readOnly} />,
  },
];
