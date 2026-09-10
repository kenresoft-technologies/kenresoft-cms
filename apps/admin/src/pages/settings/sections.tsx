import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Database,
  HardDrive,
  LayoutTemplate,
  Mail,
  Menu,
  Palette,
  Plug,
  Search,
  Settings2,
  Share2,
  Shield,
  SlidersHorizontal,
  Trash2,
  Webhook,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { Settings } from '@/lib/types';
import { AdvancedSection } from './AdvancedSection';
import { ApiSection } from './ApiSection';
import { AppearanceSection } from './AppearanceSection';
import { CacheSection } from './CacheSection';
import { ComingSoonSection } from './ComingSoonSection';
import { ContactSection } from './ContactSection';
import { FooterSection } from './FooterSection';
import { GeneralSection } from './GeneralSection';
import { NavigationSection } from './NavigationSection';
import { SeoSection } from './SeoSection';
import { SocialSection } from './SocialSection';
import { WebhooksSection } from './WebhooksSection';

export type SettingsGroupId = 'site' | 'experience' | 'system' | 'developer';

export interface SettingsGroupMeta {
  id: SettingsGroupId;
  label: string;
  description: string;
}

// Four conceptual groups, each with a short one-line description shown under its heading in the
// nav — Settings otherwise reads as one long undifferentiated list once more than a handful of
// sections exist (it grew to 15 flat entries before this pass).
export const SETTINGS_GROUPS: SettingsGroupMeta[] = [
  {
    id: 'site',
    label: 'Site',
    description: 'Configure the information and presentation used by your public-facing site.',
  },
  {
    id: 'experience',
    label: 'Experience',
    description: 'Control how the CMS looks and behaves for administrators.',
  },
  {
    id: 'system',
    label: 'System',
    description: 'Manage deployment, storage, caching, and advanced system configuration.',
  },
  {
    id: 'developer',
    label: 'Developer',
    description: 'Configure APIs and integrations for developers and external systems.',
  },
];

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'security'
  | 'notifications'
  | 'contact'
  | 'social'
  | 'navigation'
  | 'footer'
  | 'seo'
  | 'storage'
  | 'database'
  | 'api'
  | 'cache'
  | 'webhooks'
  | 'advanced';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  group: SettingsGroupId;
  available: boolean;
  /** Extra search terms beyond the label itself — e.g. "logo" for General, "theme" for Appearance. */
  keywords?: string[];
  render: (props: { settings: Settings | null; readOnly: boolean }) => ReactNode;
}

// One registry drives both the left nav and the content pane, so adding a future section (once
// its backend exists) is a single entry here instead of touching nav + routing + content
// switch separately. `available: false` entries render ComingSoonSection — the IA exists, the
// functionality doesn't, and the UI says so rather than faking it. SettingsPage hides these from
// the primary nav (grouped by `group`) and lists them separately, visually secondary, at the
// bottom, so unbuilt functionality never competes for attention with what's actually configurable.
export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  // --- Site ---
  {
    id: 'general',
    label: 'General',
    icon: Settings2,
    group: 'site',
    available: true,
    keywords: ['logo', 'branding', 'site name', 'tagline', 'deployment name'],
    render: ({ settings, readOnly }) => <GeneralSection settings={settings} readOnly={readOnly} />,
  },
  {
    id: 'contact',
    label: 'Contact',
    icon: Mail,
    group: 'site',
    available: true,
    keywords: ['email', 'phone', 'address'],
    render: ({ readOnly }) => <ContactSection readOnly={readOnly} />,
  },
  {
    id: 'social',
    label: 'Social',
    icon: Share2,
    group: 'site',
    available: true,
    keywords: ['twitter', 'facebook', 'instagram', 'linkedin', 'links'],
    render: ({ readOnly }) => <SocialSection readOnly={readOnly} />,
  },
  {
    id: 'navigation',
    label: 'Navigation',
    icon: Menu,
    group: 'site',
    available: true,
    keywords: ['menu', 'header links'],
    render: ({ readOnly }) => <NavigationSection readOnly={readOnly} />,
  },
  {
    id: 'footer',
    label: 'Footer',
    icon: LayoutTemplate,
    group: 'site',
    available: true,
    keywords: ['copyright', 'footer links'],
    render: ({ readOnly }) => <FooterSection readOnly={readOnly} />,
  },
  {
    id: 'seo',
    label: 'SEO',
    icon: Search,
    group: 'site',
    available: true,
    keywords: ['meta', 'og image', 'search engine', 'sitemap', 'title'],
    render: ({ readOnly }) => <SeoSection readOnly={readOnly} />,
  },
  // --- Experience ---
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    group: 'experience',
    available: true,
    keywords: ['theme', 'dark mode', 'light mode'],
    render: () => <AppearanceSection />,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    group: 'experience',
    available: false,
    keywords: ['email alerts', 'digest'],
    render: () => (
      <ComingSoonSection
        title="Notifications"
        icon={Bell}
        description="Email alerts for activity on this deployment."
        planned={['New form submission alerts', 'Scheduled-publish confirmations', 'Admin digest emails']}
      />
    ),
  },
  // --- System ---
  {
    id: 'security',
    label: 'Security',
    icon: Shield,
    group: 'system',
    available: false,
    keywords: ['password policy', 'two-factor', 'authentication'],
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
    id: 'storage',
    label: 'Storage',
    icon: HardDrive,
    group: 'system',
    available: false,
    keywords: ['media', 'r2', 'upload limits', 'quota'],
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
    group: 'system',
    available: false,
    keywords: ['d1', 'backup', 'migrations'],
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
    id: 'cache',
    label: 'Cache',
    icon: Trash2,
    group: 'system',
    available: true,
    keywords: ['purge', 'invalidate', 'edge cache'],
    render: ({ readOnly }) => <CacheSection readOnly={readOnly} />,
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: SlidersHorizontal,
    group: 'system',
    available: true,
    keywords: ['feature flag', 'danger zone'],
    render: ({ settings, readOnly }) => <AdvancedSection settings={settings} readOnly={readOnly} />,
  },
  // --- Developer ---
  {
    id: 'api',
    label: 'API',
    icon: Plug,
    group: 'developer',
    available: true,
    keywords: ['cors', 'openapi', 'docs', 'preview url', 'live preview'],
    render: ({ settings, readOnly }) => <ApiSection settings={settings} readOnly={readOnly} />,
  },
  {
    id: 'webhooks',
    label: 'Webhooks',
    icon: Webhook,
    group: 'developer',
    available: true,
    keywords: ['endpoint', 'delivery', 'signing secret'],
    render: () => <WebhooksSection />,
  },
];
