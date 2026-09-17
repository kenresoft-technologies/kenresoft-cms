import { useMemo, useRef, useState } from 'react';
import { Download, FileText, Folder, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { useContentType } from '@/lib/queries/content-types';
import {
  useCreateEntryFolder,
  useDeleteEntryFolder,
  useEntryFolders,
  useMoveEntries,
  useUpdateEntryFolder,
} from '@/lib/queries/entry-folders';
import {
  exportEntries,
  useDeleteEntryById,
  useEntries,
  useImportEntries,
  useUpdateEntryStatusById,
} from '@/lib/queries/entries';
import type { ContentTypeExport, EntryFolder, EntryStatus, EntryWithContentType } from '@/lib/types';
import { ContentTypeTabs } from '@/components/content-type-tabs';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

type StatusFilter = 'all' | EntryStatus;

function NewFolderDialog({ contentTypeId, parentId }: { contentTypeId: string; parentId: string | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createFolder = useCreateEntryFolder(contentTypeId);

  async function handleCreate() {
    if (!name.trim()) {
      setError('Enter a folder name');
      return;
    }
    setError(null);
    try {
      await createFolder.mutateAsync({ name: name.trim(), parentId });
      setName('');
      setOpen(false);
      toast.success('Folder created');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create folder');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FolderPlus />
        New folder
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>Organize entries of this content type into folders.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Input
            placeholder="Folder name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void handleCreate()}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={() => void handleCreate()} disabled={createFolder.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderChip({
  folder,
  contentTypeId,
  onOpen,
}: {
  folder: EntryFolder;
  contentTypeId: string;
  onOpen: (id: string) => void;
}) {
  const updateFolder = useUpdateEntryFolder(contentTypeId);
  const deleteFolder = useDeleteEntryFolder(contentTypeId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);

  async function handleRename() {
    if (!name.trim() || name === folder.name) {
      setRenaming(false);
      return;
    }
    try {
      await updateFolder.mutateAsync({ id: folder.id, name: name.trim() });
      toast.success('Folder renamed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to rename folder');
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteFolder.mutateAsync(folder.id);
      toast.success('Folder deleted — its entries are now unfiled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete folder');
    }
  }

  if (renaming) {
    return (
      <Input
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void handleRename()}
        onKeyDown={(event) => event.key === 'Enter' && void handleRename()}
        className="h-8 w-40"
      />
    );
  }

  return (
    <div className="group flex items-center gap-1 rounded-lg border bg-card py-1 pr-1 pl-3 text-sm">
      <button
        type="button"
        className="flex items-center gap-2 hover:underline"
        onClick={() => onOpen(folder.id)}
      >
        <Folder className="size-4 text-muted-foreground" />
        {folder.name}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Manage ${folder.name}`}
            className="opacity-0 group-hover:opacity-100"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <DropdownMenuItem onSelect={(event) => event.preventDefault()} variant="destructive">
                <Trash2 /> Delete
              </DropdownMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{folder.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  The folder is removed. Its entries become unfiled; any subfolders move to root. This
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function EntriesPage() {
  const navigate = useNavigate();
  const { contentTypeId } = useParams<{ contentTypeId: string }>();
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: folders } = useEntryFolders(contentTypeId ?? '');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const {
    data: entries,
    isPending,
    error,
    refetch,
  } = useEntries(contentTypeId ?? '', currentFolderId === null ? 'unfiled' : currentFolderId);
  const deleteEntry = useDeleteEntryById(contentTypeId ?? '');
  const updateStatus = useUpdateEntryStatusById(contentTypeId ?? '');
  const importEntries = useImportEntries(contentTypeId ?? '');
  const moveEntries = useMoveEntries(contentTypeId ?? '');
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pendingDelete, setPendingDelete] = useState<EntryWithContentType | EntryWithContentType[] | null>(null);

  const currentFolder = folders?.find((folder) => folder.id === currentFolderId) ?? null;
  const breadcrumbFolders = useMemo(() => {
    if (!folders) return [];
    const chain: EntryFolder[] = [];
    let cursor = currentFolder;
    while (cursor) {
      chain.unshift(cursor);
      cursor = folders.find((folder) => folder.id === cursor!.parentId) ?? null;
    }
    return chain;
  }, [folders, currentFolder]);
  const subfolders = useMemo(
    () => (folders ?? []).filter((folder) => folder.parentId === currentFolderId),
    [folders, currentFolderId],
  );

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
      {contentTypeId ? <NewFolderDialog contentTypeId={contentTypeId} parentId={currentFolderId} /> : null}
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
          { label: contentType?.name ?? '…' },
        ]}
      />

      <PageHeader
        title={contentType?.name ?? 'Entries'}
        description={contentType ? `Content — instances of ${contentType.name}.` : 'Content instances.'}
        actions={<div className="flex items-center gap-2">{headerActions}</div>}
      />

      {contentTypeId ? <ContentTypeTabs contentTypeId={contentTypeId} active="entries" /> : null}

      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <button type="button" className="hover:underline" onClick={() => setCurrentFolderId(null)}>
          Root
        </button>
        {breadcrumbFolders.map((folder) => (
          <span key={folder.id} className="flex items-center gap-1">
            <span>/</span>
            <button type="button" className="hover:underline" onClick={() => setCurrentFolderId(folder.id)}>
              {folder.name}
            </button>
          </span>
        ))}
      </div>

      {subfolders.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {subfolders.map((folder) =>
            contentTypeId ? (
              <FolderChip key={folder.id} folder={folder} contentTypeId={contentTypeId} onOpen={setCurrentFolderId} />
            ) : null,
          )}
        </div>
      ) : null}

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
              <Select
                onValueChange={(value) => {
                  void moveEntries
                    .mutateAsync({ entryIds: selected.map((entry) => entry.id), folderId: value === 'root' ? null : value })
                    .then(() => {
                      toast.success(`Moved ${selected.length} entries`);
                      clearSelection();
                    })
                    .catch((err) => toast.error(err instanceof ApiError ? err.message : 'Failed to move entries'));
                }}
              >
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue placeholder="Move to folder…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Unfiled (root)</SelectItem>
                  {(folders ?? []).map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
