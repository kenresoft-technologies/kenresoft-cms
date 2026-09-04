import { useMemo } from 'react';
import {
  ArrowRight,
  BookOpen,
  ClipboardList,
  Code2,
  FileText,
  Image as ImageIcon,
  LayoutList,
  Plus,
  Upload,
  Users as UsersIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { Cell, Pie, PieChart } from 'recharts';

import { API_URL } from '@/lib/api-client';
import { formatBytes } from '@/lib/format';
import { useDashboardStats } from '@/lib/queries/dashboard';
import { useForms } from '@/lib/queries/forms';
import { useUsers } from '@/lib/queries/users';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { StorageUsageCard } from '@/components/storage-usage-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardStats } from '@/lib/types';

// Draft/published get meaningful colors, not the arbitrary grayscale this used before —
// published in --success matches StatusBadge's own green-for-published convention everywhere
// else in the admin.
const chartConfig = {
  draft: { label: 'Draft', color: 'var(--muted-foreground)' },
  published: { label: 'Published', color: 'var(--success)' },
} satisfies ChartConfig;

const QUICK_ACTIONS = [
  { to: '/content-types', label: 'New content type', description: 'Define a reusable shape for your content', icon: LayoutList },
  { to: '/media', label: 'Upload media', description: 'Add images to your library', icon: Upload },
  { to: '/forms', label: 'New form', description: 'Start collecting visitor submissions', icon: ClipboardList },
] as const;

function QuickActionsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
        <CardDescription>Jump straight into common tasks.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="group flex items-center gap-3 rounded-lg p-2 -mx-2 hover:bg-muted/50"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
              <action.icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{action.label}</p>
              <p className="truncate text-xs text-muted-foreground">{action.description}</p>
            </div>
            <Plus className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function EntryList({ entries, emptyMessage }: { entries: DashboardStats['recentEntries']; emptyMessage: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => (
        <Link
          key={entry.id}
          to={`/content-types/${entry.contentTypeId}/entries/${entry.id}`}
          className="flex items-center justify-between gap-2 rounded-lg border p-2 hover:bg-muted/50"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{entry.slug}</span>
            <span className="truncate text-xs text-muted-foreground">{entry.contentTypeName}</span>
          </div>
          <StatusBadge status={entry.status} />
        </Link>
      ))}
    </div>
  );
}

function OnboardingCard() {
  return (
    <Card className="max-w-md">
      <CardHeader>
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <LayoutList className="size-5 text-primary" />
        </div>
        <CardTitle>Start with a content type</CardTitle>
        <CardDescription>
          Content types are the top-level building block for this deployment (§11) — define
          one, add fields to it, then start creating entries.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/content-types">
            Go to content types
            <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { data: stats, isPending } = useDashboardStats();
  const { data: forms } = useForms();
  const { data: users } = useUsers();

  const chartData = useMemo(
    () =>
      stats
        ? [
            { status: 'draft', label: 'Draft', count: stats.entryCounts.draft, fill: 'var(--color-draft)' },
            { status: 'published', label: 'Published', count: stats.entryCounts.published, fill: 'var(--color-published)' },
          ]
        : [],
    [stats],
  );

  const drafts = useMemo(() => stats?.recentEntries.filter((entry) => entry.status === 'draft') ?? [], [stats]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Welcome back — here's what's happening across your content."
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`${API_URL}/api/v1/docs`} target="_blank" rel="noreferrer">
                <BookOpen />
                API reference
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`${API_URL}/api/v1/openapi.json`} target="_blank" rel="noreferrer">
                <Code2 />
                OpenAPI JSON
              </a>
            </Button>
          </>
        }
      />

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {stats && stats.contentTypeCount === 0 ? <OnboardingCard /> : null}

      {stats && stats.contentTypeCount > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard icon={LayoutList} label="Content types" value={String(stats.contentTypeCount)} />
            <StatCard
              icon={FileText}
              label="Entries"
              value={String(stats.entryCounts.draft + stats.entryCounts.published)}
              hint={`${stats.entryCounts.published} published, ${stats.entryCounts.draft} draft`}
            />
            <StatCard
              icon={ImageIcon}
              label="Media"
              value={String(stats.mediaCount)}
              hint={formatBytes(stats.mediaStorageBytes)}
              tone="success"
            />
            <StatCard icon={ClipboardList} label="Forms" value={String(forms?.length ?? 0)} />
            <StatCard icon={UsersIcon} label="Users" value={String(users?.length ?? 0)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Draft vs. published</CardTitle>
                <CardDescription>Entries across every content type.</CardDescription>
              </CardHeader>
              <CardContent>
                {stats.entryCounts.draft + stats.entryCounts.published > 0 ? (
                  <ChartContainer config={chartConfig} className="mx-auto max-h-64">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                      <Pie data={chartData} dataKey="count" nameKey="status" innerRadius={50} outerRadius={80} strokeWidth={2}>
                        {chartData.map((entry) => (
                          <Cell key={entry.status} fill={entry.fill} />
                        ))}
                      </Pie>
                      <ChartLegend content={<ChartLegendContent nameKey="status" />} />
                    </PieChart>
                  </ChartContainer>
                ) : (
                  <p className="text-sm text-muted-foreground">No entries yet.</p>
                )}
              </CardContent>
            </Card>

            <QuickActionsCard />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>Last updated entries.</CardDescription>
              </CardHeader>
              <CardContent>
                <EntryList entries={stats.recentEntries} emptyMessage="Nothing yet." />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Drafts</CardTitle>
                <CardDescription>Unpublished entries among recent activity.</CardDescription>
              </CardHeader>
              <CardContent>
                <EntryList entries={drafts} emptyMessage="No drafts among recently updated entries." />
              </CardContent>
            </Card>

            <StorageUsageCard stats={stats} />
          </div>
        </>
      ) : null}
    </div>
  );
}
