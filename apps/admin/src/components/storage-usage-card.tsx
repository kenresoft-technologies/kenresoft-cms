import { Database, Image as ImageIcon } from 'lucide-react';

import { formatBytes } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardStats } from '@/lib/types';

export function StorageUsageCard({ stats }: { stats: DashboardStats }) {
  const entryCount = stats.entryCounts.draft + stats.entryCounts.published;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage usage</CardTitle>
        <CardDescription>Real usage across this deployment's own resources.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-success/12">
            <ImageIcon className="size-4 text-success" />
          </div>
          <div>
            <p className="text-sm font-medium">{formatBytes(stats.mediaStorageBytes)}</p>
            <p className="text-xs text-muted-foreground">
              {stats.mediaCount} {stats.mediaCount === 1 ? 'file' : 'files'} in R2 — no fixed size limit.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Database className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {stats.contentTypeCount} content {stats.contentTypeCount === 1 ? 'type' : 'types'}, {entryCount}{' '}
              {entryCount === 1 ? 'entry' : 'entries'}
            </p>
            <p className="text-xs text-muted-foreground">
              Everything else lives in D1 — Cloudflare doesn't expose a per-database size to a
              Worker at runtime.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
