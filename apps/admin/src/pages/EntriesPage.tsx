import { useMemo, useRef, useState } from 'react';
import { Download, FileText, Plus, Trash2, Upload } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { useContentType } from '@/lib/queries/content-types';
import {
  exportEntries,
  useDeleteEntryById,
  useEntries,
  useImportEntries,
  useUpdateEntryStatusById,
} from '@/lib/queries/entries';
import type { ContentTypeExport, EntryStatus, EntryWithContentType } from '@/lib/types';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

type StatusFilter = 'all' | EntryStatus;

export function EntriesPage() {
  const navigate = useNavigate();
  const { contentTypeId } = useParams<{ contentTypeId: string }>();
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: entries, isPending, error, refetch } = useEntries(contentTypeId ?? '');
  const deleteEntry = useDeleteEntryById(contentTypeId ?? '');
  const updateStatus = useUpdateEntryStatusById(contentTypeId ?? '');
  const importEntries = useImportEntries(contentTypeId ?? '');
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pendingDelete, setPendingDelete] = useState<EntryWithContentType | EntryWithContentType[] | null>(null);

  async function handleExport() {
    if (!contentTypeId) return;
    try {
      const data = await exportEntries(contentTypeId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data.contentType.slug}-entries.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Export failed');
    }
  }

  function handleImportClick() {
    importFileInputRef.current?.click();
  }

  async function handleImportFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    let parsed: ContentTypeExport;
    try {
      parsed = JSON.parse(await file.text()) as ContentTypeExport;
    } catch {
      toast.error('That file is not valid JSON');
      return;
    }

    try {
      const result = await importEntries.mutateAsync(parsed);
      const parts = [`${result.created} created`, `${result.updated} updated`];
      if (result.errors.length > 0) parts.push(`${result.errors.length} failed`);
      if (result.errors.length > 0) {
        toast.warning(`Import finished: ${parts.join(', ')}`, {
          description: result.errors.map((e) => `${e.slug}: ${e.error}`).join('; '),
        });
      } else {
        toast.success(`Import finished: ${parts.join(', ')}`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Import failed');
    }
  }

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

  async function handleBulkPublish(rows: EntryWithContentType[], status: EntryStatus, clearSelection: () => void) {
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
            to={`/content-types/${contentTypeId}/entries/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {row.original.slug}
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
        cell: ({ row }) =>
          contentTypeId ? (
            <EntryRowActions entry={row.original} contentTypeId={contentTypeId} onRequestDelete={setPendingDelete} />
          ) : null,
      },
    ],
    [contentTypeId],
  );

  const headerActions = (
    <>
      <input
        ref={importFileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => void handleImportFileSelected(event)}
      />
      <Button variant="outline" onClick={handleImportClick} disabled={importEntries.isPending}>
        <Upload />
        Import
      </Button>
      <Button variant="outline" onClick={() => void handleExport()} disabled={!entries || entries.length === 0}>
        <Download />
        Export
      </Button>
      <Button asChild>
        <Link to={`/content-types/${contentTypeId}/entries/new`}>
          <Plus />
          New entry
        </Link>
      </Button>
    </>
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
        actions={<div className="flex items-center gap-2">{headerActions}</div>}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={4} />
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
          onRefresh={() => void refetch()}
          enableRowSelection
          toolbar={
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
