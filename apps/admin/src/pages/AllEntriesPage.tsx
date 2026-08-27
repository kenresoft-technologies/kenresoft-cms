import { useMemo, useState } from 'react';
import { ChevronDown, FileText, Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { useContentTypes } from '@/lib/queries/content-types';
import { useAllEntries, useDeleteEntryGlobal, useUpdateEntryStatusGlobal } from '@/lib/queries/all-entries';
import type { EntryStatus, EntryWithContentType } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { EntryRowActions } from '@/components/entry-row-actions';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

type StatusFilter = 'all' | EntryStatus;

function NewEntryMenu() {
  const { data: contentTypes } = useContentTypes();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={!contentTypes || contentTypes.length === 0}>
          <Plus />
          New entry
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {contentTypes?.map((contentType) => (
          <DropdownMenuItem key={contentType.id} asChild>
            <Link to={`/content-types/${contentType.id}/entries/new`}>{contentType.name}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AllEntriesPage() {
  const navigate = useNavigate();
  const { data: entries, isPending, error, refetch } = useAllEntries();
  const { data: contentTypes } = useContentTypes();
  const deleteEntry = useDeleteEntryGlobal();
  const updateStatus = useUpdateEntryStatusGlobal();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [contentTypeFilter, setContentTypeFilter] = useState('all');
  const [pendingDelete, setPendingDelete] = useState<EntryWithContentType | EntryWithContentType[] | null>(null);

  const filteredEntries = useMemo(() => {
    return (entries ?? []).filter((entry) => {
      if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
      if (contentTypeFilter !== 'all' && entry.contentTypeId !== contentTypeFilter) return false;
      return true;
    });
  }, [entries, statusFilter, contentTypeFilter]);

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

  async function handleBulkPublish(
    rows: EntryWithContentType[],
    status: EntryStatus,
    clearSelection: () => void,
  ) {
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

  const columns = useMemo<ColumnDef<EntryWithContentType>[]>(
    () => [
      {
        accessorKey: 'slug',
        header: 'Slug',
        cell: ({ row }) => (
          <Link
            to={`/content-types/${row.original.contentTypeId}/entries/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {row.original.slug}
          </Link>
        ),
      },
      {
        accessorKey: 'contentTypeName',
        header: 'Content Type',
        cell: ({ row }) => (
          <Link to={`/content-types/${row.original.contentTypeId}`} className="text-muted-foreground hover:underline">
            {row.original.contentTypeName}
          </Link>
        ),
      },
      {
        accessorKey: 'authorName',
        header: 'Author',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.authorName ?? '—'}</span>,
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
        cell: ({ row }) => (
          <EntryRowActions
            entry={row.original}
            contentTypeId={row.original.contentTypeId}
            onRequestDelete={setPendingDelete}
          />
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Entries' }]} />

      <PageHeader
        title="Entries"
        description="Every entry across every content type."
        actions={<NewEntryMenu />}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Content Type</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={5} />
          </Table>
        </div>
      ) : null}

      {entries && entries.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No entries yet"
          description="Create a content type, then add entries to it."
        />
      ) : null}

      {entries && entries.length > 0 ? (
        <DataTable
          columns={columns}
          data={filteredEntries}
          searchPlaceholder="Search entries…"
          onRowClick={(row) => navigate(`/content-types/${row.contentTypeId}/entries/${row.id}`)}
          onRefresh={() => void refetch()}
          enableRowSelection
          toolbar={
            <>
              <Select value={contentTypeFilter} onValueChange={setContentTypeFilter}>
                <SelectTrigger size="sm" className="w-40" aria-label="Filter by content type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All content types</SelectItem>
                  {contentTypes?.map((contentType) => (
                    <SelectItem key={contentType.id} value={contentType.id}>
                      {contentType.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
            </>
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
