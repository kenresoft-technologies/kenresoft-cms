import { useMemo } from 'react';
import { ArrowRight, FileText, Image as ImageIcon, LayoutList, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Cell, Pie, PieChart } from 'recharts';

import { formatBytes } from '@/lib/format';
import { useDashboardStats } from '@/lib/queries/dashboard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';

const chartConfig = {
  draft: { label: 'Draft', color: 'var(--chart-1)' },
  published: { label: 'Published', color: 'var(--chart-2)' },
} satisfies ChartConfig;

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="size-5 text-primary" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to Kenresoft CMS.</p>
      </div>

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
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard icon={LayoutList} label="Content types" value={String(stats.contentTypeCount)} />
            <StatCard
              icon={FileText}
              label="Entries"
              value={String(stats.entryCounts.draft + stats.entryCounts.published)}
              hint={`${stats.entryCounts.published} published, ${stats.entryCounts.draft} draft`}
            />
            <StatCard icon={ImageIcon} label="Media" value={String(stats.mediaCount)} hint={formatBytes(stats.mediaStorageBytes)} />
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

            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>Last updated entries.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {stats.recentEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing yet.</p>
                ) : (
                  stats.recentEntries.map((entry) => (
                    <Link
                      key={entry.id}
                      to={`/content-types/${entry.contentTypeId}/entries/${entry.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border p-2 hover:bg-muted/50"
                    >
                      <div className="flex flex-col gap-0.5 overflow-hidden">
                        <span className="truncate text-sm font-medium">{entry.slug}</span>
                        <span className="truncate text-xs text-muted-foreground">{entry.contentTypeName}</span>
                      </div>
                      <Badge variant={entry.status === 'published' ? 'default' : 'secondary'}>{entry.status}</Badge>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
