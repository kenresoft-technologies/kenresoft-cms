import { useMemo, useState } from 'react';
import { Copy, FileText, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { useContentType } from '@/lib/queries/content-types';
import {
  useCreateEntry,
  useDeleteEntryById,
  useEntries,
  useUpdateEntryStatusById,
} from '@/lib/queries/entries';
import type { Entry, EntryStatus } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { TableSkeleton } from '@/components/table-skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

type StatusFilter = 'all' | EntryStatus;

function slugCopy(slug: string) {
  return `${slug}-copy`;
}

function RowActions({
  entry,
  contentTypeId,
  onRequestDelete,
}: {
  entry: Entry;
  contentTypeId: string;
  onRequestDelete: (entry: Entry) => void;
}) {
  const navigate = useNavigate();
  const createEntry = useCreateEntry(contentTypeId);
  const updateStatus = useUpdateEntryStatusById(contentTypeId);
  const nextStatus: EntryStatus = entry.status === 'published' ? 'draft' : 'published';

  async function handleDuplicate() {
    try {
      const created = await createEntry.mutateAsync({
        slug: slugCopy(entry.slug),
        status: 'draft',
        data: entry.data,
        publishAt: null,
      });
      toast.success('Entry duplicated');
      void navigate(`/content-types/${contentTypeId}/entries/${created.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to duplicate entry');
    }
  }

  function handleToggleStatus() {
    updateStatus.mutate(
      { id: entry.id, status: nextStatus },
      {
        onSuccess: () => toast.success(nextStatus === 'published' ? 'Entry published' : 'Entry unpublished'),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to update status'),
      },
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Entry actions" className="opacity-0 group-hover:opacity-100">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to={`/content-types/${contentTypeId}/entries/${entry.id}`}>Edit</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDuplicate} disabled={createEntry.isPending}>
          <Copy />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleToggleStatus} disabled={updateStatus.isPending}>
          {nextStatus === 'published' ? 'Publish' : 'Unpublish'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onRequestDelete(entry)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EntriesPage() {
  const navigate = useNavigate();
  const { contentTypeId } = useParams<{ contentTypeId: string }>();
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: entries, isPending, error } = useEntries(contentTypeId ?? '');
  const deleteEntry = useDeleteEntryById(contentTypeId ?? '');
  const updateStatus = useUpdateEntryStatusById(contentTypeId ?? '');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pendingDelete, setPendingDelete] = useState<Entry | Entry[] | null>(null);

  const filteredEntries = useMemo(
    () => (statusFilter === 'all' ? (entries ?? []) : (entries ?? []).filter((entry) => entry.status === statusFilter)),
    [entries, statusFilter],
  );

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    const targets = Array.isArray(pendingDelete) ? pendingDelete : [pendingDelete];

    const results = await Promise.allSettled(targets.map((entry) => deleteEntry.mutateAsync(entry.id)));
    const failed = results.filter((result) => result.status === 'rejected').length;

    if (failed === 0) {
      toast.success(targets.length === 1 ? 'Entry deleted' : `${targets.length} entries deleted`);
    } else {
      toast.error(`${failed} of ${targets.length} entries failed to delete`);
    }
    setPendingDelete(null);
  }

  async function handleBulkPublish(rows: Entry[], status: EntryStatus, clearSelection: () => void) {
    const results = await Promise.allSettled(
      rows.map((entry) => updateStatus.mutateAsync({ id: entry.id, status })),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;

    if (failed === 0) {
      toast.success(`${rows.length} entries ${status === 'published' ? 'published' : 'unpublished'}`);
    } else {
      toast.error(`${failed} of ${rows.length} entries failed to update`);
    }
    clearSelection();
  }

  const columns = useMemo<ColumnDef<Entry>[]>(
    () => [
      {
        accessorKey: 'slug',
        header: 'Slug',
        cell: ({ row }) => (
          <Link
            to={`/content-types/${contentTypeId}/entries/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {row.original.slug}
          </Link>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        sortingFn: (rowA, rowB) =>
          new Date(rowA.original.updatedAt).getTime() - new Date(rowB.original.updatedAt).getTime(),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{new Date(row.original.updatedAt).toLocaleString()}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) =>
          contentTypeId ? (
            <RowActions entry={row.original} contentTypeId={contentTypeId} onRequestDelete={setPendingDelete} />
          ) : null,
      },
    ],
    [contentTypeId],
  );

  const newEntryLink = (
    <Button asChild>
      <Link to={`/content-types/${contentTypeId}/entries/new`}>
        <Plus />
        New entry
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Content types', to: '/content-types' },
          { label: contentType?.name ?? '…', to: `/content-types/${contentTypeId}` },
          { label: 'Entries' },
        ]}
      />

      <PageHeader
        title="Entries"
        description={contentType ? `Instances of ${contentType.name}.` : 'Content instances.'}
        actions={newEntryLink}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={3} />
          </Table>
        </div>
      ) : null}

      {entries && entries.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No entries yet"
          description="Create your first entry for this content type."
        />
      ) : null}

      {entries && entries.length > 0 ? (
        <DataTable
          columns={columns}
          data={filteredEntries}
          searchPlaceholder="Search entries…"
          onRowClick={(row) => navigate(`/content-types/${contentTypeId}/entries/${row.id}`)}
          enableRowSelection
          toolbar={
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
              </SelectContent>
            </Select>
          }
          bulkActions={(selected, clearSelection) => (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleBulkPublish(selected, 'published', clearSelection)}
              >
                Publish
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleBulkPublish(selected, 'draft', clearSelection)}
              >
                Unpublish
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setPendingDelete(selected)}>
                <Trash2 />
                Delete
              </Button>
            </>
          )}
        />
      ) : null}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {Array.isArray(pendingDelete)
                ? `Delete ${pendingDelete.length} entries?`
                : `Delete "${pendingDelete?.slug}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {Array.isArray(pendingDelete) ? 'these entries' : 'this entry'} and their
              revision history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleConfirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
