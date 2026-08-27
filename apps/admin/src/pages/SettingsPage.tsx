import { useState } from 'react';

import { authClient } from '@/lib/auth-client';
import { useSettings } from '@/lib/queries/settings';
import { cn } from '@/lib/utils';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './settings/sections';

export function SettingsPage() {
  const { data: session } = authClient.useSession();
  const isOwner = session?.user.role === 'owner';
  const { data: settings, isPending } = useSettings();
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>('general');

  const activeSection = SETTINGS_SECTIONS.find((section) => section.id === activeSectionId)!;

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Settings' }]} />

      <PageHeader
        title="Settings"
        description={`Administration and configuration for this deployment.${!isOwner ? ' Only owners can make changes.' : ''}`}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSectionId(section.id)}
              aria-current={activeSectionId === section.id ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                activeSectionId === section.id
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <section.icon className="size-4 shrink-0" />
              <span className="flex-1">{section.label}</span>
              {!section.available ? (
                <Badge variant="outline" className="text-[10px]">
                  Soon
                </Badge>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {isPending ? (
            <Card>
              <CardContent className="flex flex-col gap-4 pt-6">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ) : (
            activeSection.render({ settings: settings ?? null, readOnly: !isOwner })
          )}
        </div>
      </div>
    </div>
  );
}
