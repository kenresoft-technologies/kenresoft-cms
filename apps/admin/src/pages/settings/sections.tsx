import type { LucideIcon } from 'lucide-react';
import { Bell, Database, HardDrive, Palette, Plug, Settings2, Share2, Shield, SlidersHorizontal, UserCog, Webhook } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Settings } from '@/lib/types';
import { AdvancedSection } from './AdvancedSection';
import { ApiSection } from './ApiSection';
import { AppearanceSection } from './AppearanceSection';
import { ComingSoonSection } from './ComingSoonSection';
import { GeneralSection } from './GeneralSection';
import { SocialSection } from './SocialSection';
import { UsersPermissionsSection } from './UsersPermissionsSection';

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'security'
  | 'notifications'
  | 'social'
  | 'storage'
  | 'database'
  | 'api'
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
        description="Authentication and session policy for this deployment."
        planned={['Two-factor authentication', 'Active session management', 'Password policy controls']}
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
        planned={['New form submission alerts', 'Scheduled-publish confirmations', 'Owner digest emails']}
      />
    ),
  },
  {
    id: 'social',
    label: 'Social',
    icon: Share2,
    available: true,
    render: ({ settings, readOnly }) => <SocialSection settings={settings} readOnly={readOnly} />,
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
    available: false,
    render: () => (
      <ComingSoonSection
        title="Webhooks"
        icon={Webhook}
        description="Outbound notifications when content changes in this deployment."
        planned={['Per-content-type publish/unpublish webhooks', 'Delivery logs and retries', 'Signing secrets']}
      />
    ),
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: SlidersHorizontal,
    available: true,
    render: ({ settings, readOnly }) => <AdvancedSection settings={settings} readOnly={readOnly} />,
  },
];
