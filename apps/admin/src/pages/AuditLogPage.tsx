import { useMemo, useState } from 'react';
import { ClipboardList, Eye } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { useAuditLog } from '@/lib/queries/audit-log';
import { useUsers } from '@/lib/queries/users';
import type { AuditLogEntryWithActor } from '@/lib/types';
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

function MetadataDialog({ entry }: { entry: AuditLogEntryWithActor }) {
  const [open, setOpen] = useState(false);
  const hasMetadata = entry.metadata !== null && Object.keys(entry.metadata).length > 0;

  if (!hasMetadata) return <span className="text-muted-foreground">—</span>;

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
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted/40 p-3 text-xs">
            {JSON.stringify(entry.metadata, null, 2)}
          </pre>
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

      <PageHeader title="Audit log" description="Every logged content, structural, and auth event, newest first." />

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
