import { History } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useEntryRevisions, useRestoreEntryRevision } from '@/lib/queries/entries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';

interface EntryRevisionHistoryProps {
  contentTypeId: string;
  entryId: string;
}

export function EntryRevisionHistory({ contentTypeId, entryId }: EntryRevisionHistoryProps) {
  const { data: revisions, isPending } = useEntryRevisions(entryId);
  const restoreRevision = useRestoreEntryRevision(contentTypeId, entryId);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <History />
          History
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Revision history</SheetTitle>
          <SheetDescription>
            Snapshots taken before every save. Restoring saves the current state as a new
            revision first, so nothing is ever lost.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
          {isPending ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : null}

          {revisions && revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revisions yet.</p>
          ) : null}

          {revisions?.map((revision) => (
            <div key={revision.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={revision.status === 'published' ? 'default' : 'secondary'}>
                  {revision.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(revision.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm">{revision.slug}</p>
              <Button
                variant="outline"
                size="sm"
                disabled={restoreRevision.isPending}
                onClick={() =>
                  restoreRevision.mutate(revision.id, {
                    onSuccess: () => toast.success('Revision restored'),
                    onError: (err) =>
                      toast.error(err instanceof ApiError ? err.message : 'Failed to restore revision'),
                  })
                }
              >
                Restore
              </Button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
