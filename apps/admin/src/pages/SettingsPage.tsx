import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useSearchParams } from 'react-router';

import { authClient } from '@/lib/auth-client';
import { useSettings } from '@/lib/queries/settings';
import { roleAtLeast, type UserRole } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsSectionId } from './settings/sections';

function matchesSearch(section: (typeof SETTINGS_SECTIONS)[number], query: string): boolean {
  const haystack = [section.label, ...(section.keywords ?? [])].join(' ').toLowerCase();
  return haystack.includes(query);
}

export function SettingsPage() {
  const { data: session } = authClient.useSession();
  const isAdmin = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'admin');
  const { data: settings, isPending } = useSettings();
  // Deep-linkable via ?section=api — e.g. the Entry Editor's Live Preview button links here
  // when nothing's configured yet, landing directly on the right card instead of just naming it.
  const [searchParams] = useSearchParams();
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(() => {
    const requested = searchParams.get('section');
    return SETTINGS_SECTIONS.some((section) => section.id === requested)
      ? (requested as SettingsSectionId)
      : 'general';
  });
  const [query, setQuery] = useState('');

  const activeSection = SETTINGS_SECTIONS.find((section) => section.id === activeSectionId)!;
  const normalizedQuery = query.trim().toLowerCase();

  // Unavailable sections are excluded from every group's primary listing — they'd otherwise
  // dominate the nav (5 of 15 sections were `available: false` before this pass) and make
  // not-yet-built functionality look like it's sitting alongside real, working settings.
  const groupedSections = useMemo(() => {
    return SETTINGS_GROUPS.map((group) => ({
      group,
      sections: SETTINGS_SECTIONS.filter(
        (section) =>
          section.group === group.id &&
          section.available &&
          (normalizedQuery === '' || matchesSearch(section, normalizedQuery)),
      ),
    })).filter((entry) => entry.sections.length > 0);
  }, [normalizedQuery]);

  const comingSoonSections = useMemo(() => SETTINGS_SECTIONS.filter((section) => !section.available), []);
  const noResults = normalizedQuery !== '' && groupedSections.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Settings' }]} />

      <PageHeader
        title="Settings"
        description={`Configure your CMS deployment.${!isAdmin ? ' Only admins can make changes.' : ''}`}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[240px_1fr]">
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="settings-search" className="sr-only">
              Search settings
            </label>
            <Input
              id="settings-search"
              placeholder="Search settings…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
            />
          </div>

          {/* Compact selector on mobile/tablet instead of a tall nested sidebar — grouped via
              SelectGroup so the current section's group context stays visible even collapsed. */}
          <div className="lg:hidden">
            <label htmlFor="settings-section-select" className="sr-only">
              Settings section
            </label>
            {noResults ? (
              <p className="px-1 text-sm text-muted-foreground">No settings match “{query}”.</p>
            ) : (
              <Select value={activeSectionId} onValueChange={(value) => setActiveSectionId(value as SettingsSectionId)}>
                <SelectTrigger id="settings-section-select" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupedSections.map(({ group, sections }) => (
                    <SelectGroup key={group.id}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {sections.map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <nav aria-label="Settings sections" className="hidden flex-col gap-5 lg:flex">
            {noResults ? (
              <p className="px-1 text-sm text-muted-foreground">No settings match “{query}”.</p>
            ) : (
              groupedSections.map(({ group, sections }) => (
                <div key={group.id} className="flex flex-col gap-1">
                  <div className="px-3">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {group.label}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {sections.map((section) => (
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
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}

            {/* Visually secondary — muted, no active-state styling, grouped under its own
                small heading — so unbuilt functionality never competes with real settings for
                attention, while still being reachable to see what's planned. */}
            {comingSoonSections.length > 0 && normalizedQuery === '' ? (
              <div className="flex flex-col gap-1 border-t pt-4">
                <div className="px-3">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground/70 uppercase">
                    Coming soon
                  </p>
                </div>
                <div className="flex flex-col gap-0.5">
                  {comingSoonSections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSectionId(section.id)}
                      aria-current={activeSectionId === section.id ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-muted-foreground',
                        activeSectionId === section.id && 'bg-muted/50 text-muted-foreground',
                      )}
                    >
                      <section.icon className="size-4 shrink-0" />
                      <span className="flex-1">{section.label}</span>
                      <Badge variant="outline" className="text-[10px]">
                        Soon
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </nav>
        </div>

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
            activeSection.render({ settings: settings ?? null, readOnly: !isAdmin })
          )}
        </div>
      </div>
    </div>
  );
}
