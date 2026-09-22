import { useMemo, useState, type ReactNode } from 'react';
import { ClipboardList, Eye, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { authClient } from '@/lib/auth-client';
import { ApiError } from '@/lib/api-client';
import { useAuditLog, useClearAuditLog } from '@/lib/queries/audit-log';
import { useUsers } from '@/lib/queries/users';
import type { AuditLogEntryWithActor } from '@/lib/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

// "auth.sign_in_failed" -> "Sign in failed" — the category prefix (before the dot) becomes the
// Target column instead, so it isn't repeated in the action label itself.
function formatAction(action: string): string {
  const verb = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
  const words = verb.split('_');
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function actionCategory(action: string): string {
  return action.includes('.') ? action.split('.')[0]! : action;
}

// "targetContentTypeId" -> "Target content type id" -- splits camelCase/snake_case into words
// and title-cases the first one only, matching how a normal sentence reads rather than shouting
// every word (Title Case On Every Word reads like a label, not a sentence).
function formatMetadataKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return key;
  return [words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1), ...words.slice(1)].join(' ');
}

// A key ending in "At"/"at" holding an ISO-looking string is almost always a timestamp
// (publishedAt, expiresAt, ...) — worth formatting as a real date/time instead of the raw string.
function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(new Date(value).getTime());
}

function MetadataValue({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground italic">none</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'string') {
    if (isIsoDateString(value)) return <span>{new Date(value).toLocaleString()}</span>;
    return <span className="break-all">{value || <span className="text-muted-foreground italic">(empty)</span>}</span>;
  }
  if (typeof value === 'number') return <span>{value}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground italic">none</span>;
    // A flat array of primitives reads better as a comma list than a nested sub-table.
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return <span className="break-all">{value.map((item) => String(item)).join(', ')}</span>;
    }
    return (
      <div className="flex flex-col gap-2">
        {value.map((item, i) => (
          <div key={i} className="rounded border bg-background p-2">
            <MetadataValue value={item} />
          </div>
        ))}
      </div>
    );
  }
  // A nested object: render as its own key/value list, one level of indentation deep — the
  // shapes audit metadata actually carries (a changed field's { from, to }, a target's identity)
  // never nest more than this, so this doesn't need to recurse indefinitely.
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-muted-foreground italic">none</span>;
  return (
    <dl className="flex flex-col gap-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
          <dt className="text-muted-foreground">{formatMetadataKey(k)}</dt>
          <dd className="text-right">
            <MetadataValue value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MetadataDialog({ entry }: { entry: AuditLogEntryWithActor }) {
  const [open, setOpen] = useState(false);
  const hasMetadata = entry.metadata !== null && Object.keys(entry.metadata).length > 0;
  const hasTarget = entry.targetType || entry.targetId;

  if (!hasMetadata && !hasTarget) return <span className="text-muted-foreground">—</span>;

  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label="View details" onClick={() => setOpen(true)}>
        <Eye />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{formatAction(entry.action)}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
              <span className="text-muted-foreground">When</span>
              <span>{new Date(entry.createdAt).toLocaleString()}</span>
              <span className="text-muted-foreground">Actor</span>
              <span>{entry.actorName ?? entry.actorEmail ?? entry.actorLabel ?? 'System'}</span>
              {entry.targetType ? (
                <>
                  <span className="text-muted-foreground">Target type</span>
                  <span className="capitalize">{entry.targetType.replace(/_/g, ' ')}</span>
                </>
              ) : null}
              {entry.targetId ? (
                <>
                  <span className="text-muted-foreground">Target id</span>
                  <span className="break-all font-mono text-xs">{entry.targetId}</span>
                </>
              ) : null}
            </div>
            {hasMetadata ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">Details</span>
                <div className="max-h-80 overflow-auto rounded-lg border p-3">
                  <MetadataValue value={entry.metadata} />
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AuditLogPage() {
  const [actorUserId, setActorUserId] = useState('all');
  const [action, setAction] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: session } = authClient.useSession();
  const isOwner = session?.user.role === 'owner';
  const clearAuditLog = useClearAuditLog();

  const { data: users } = useUsers();
  // actor/action are filtered client-side below, not sent to the server — the server-side
  // query params exist for a heavier deployment's history, but filtering the already-fetched
  // page client-side is what lets the action dropdown's own options be derived from the full
  // (date-filtered-only) result set rather than shrinking to just whatever's already selected.
  const {
    data: allEntries,
    isPending,
    error,
    refetch,
  } = useAuditLog({
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  });

  const knownActions = useMemo(() => {
    const set = new Set((allEntries ?? []).map((entry) => entry.action));
    return Array.from(set).sort();
  }, [allEntries]);

  const entries = useMemo(() => {
    if (!allEntries) return undefined;
    return allEntries.filter((entry) => {
      if (actorUserId !== 'all' && entry.actorUserId !== actorUserId) return false;
      if (action !== 'all' && entry.action !== action) return false;
      return true;
    });
  }, [allEntries, actorUserId, action]);

  const columns = useMemo<ColumnDef<AuditLogEntryWithActor>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'When',
        sortingFn: (rowA, rowB) => new Date(rowA.original.createdAt).getTime() - new Date(rowB.original.createdAt).getTime(),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleString()}
          </span>
        ),
      },
      {
        id: 'actor',
        header: 'Actor',
        cell: ({ row }) => {
          const { actorName, actorEmail, actorLabel } = row.original;
          if (actorName || actorEmail) {
            return (
              <div className="flex flex-col">
                <span className="font-medium">{actorName ?? actorEmail}</span>
                {actorName && actorEmail ? <span className="text-xs text-muted-foreground">{actorEmail}</span> : null}
              </div>
            );
          }
          return <span className="text-muted-foreground italic">{actorLabel ?? 'system'}</span>;
        },
      },
      {
        id: 'category',
        header: 'Target',
        cell: ({ row }) => (
          <Badge variant="secondary" className="capitalize">
            {actionCategory(row.original.action).replace(/_/g, ' ')}
          </Badge>
        ),
      },
      {
        accessorKey: 'action',
        header: 'Action',
        cell: ({ row }) => <span>{formatAction(row.original.action)}</span>,
      },
      {
        id: 'details',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <MetadataDialog entry={row.original} />
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Audit log' }]} />

      <PageHeader
        title="Audit log"
        description="Every logged content, structural, and auth event, newest first."
        actions={
          isOwner ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive">
                  <Trash2 />
                  Clear audit log
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear the entire audit log?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Permanently deletes every logged event, including other admins' actions. This
                    clearing action itself is recorded as the log's new first entry, so there's
                    never zero evidence a wipe happened. This can't be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      clearAuditLog.mutate(undefined, {
                        onSuccess: () => toast.success('Audit log cleared'),
                        onError: (err) =>
                          toast.error(err instanceof ApiError ? err.message : 'Failed to clear audit log'),
                      })
                    }
                  >
                    Clear audit log
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : undefined
        }
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Action</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={5} />
          </Table>
        </div>
      ) : null}

      {entries && entries.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No matching activity"
          description="Nothing has been logged yet, or no entries match the current filters."
        />
      ) : null}

      {entries && entries.length > 0 ? (
        <DataTable
          columns={columns}
          data={entries}
          searchPlaceholder="Search audit log…"
          onRefresh={() => void refetch()}
          toolbar={
            <>
              <Select value={actorUserId} onValueChange={setActorUserId}>
                <SelectTrigger size="sm" className="w-40" aria-label="Filter by actor">
                  <SelectValue placeholder="All actors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actors</SelectItem>
                  {(users ?? []).map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger size="sm" className="w-44" aria-label="Filter by action">
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {knownActions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {formatAction(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-36"
                aria-label="From date"
              />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" aria-label="To date" />
            </>
          }
        />
      ) : null}
    </div>
  );
}
