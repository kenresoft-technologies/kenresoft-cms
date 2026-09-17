import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Folder, FolderCog, FolderOpen, FolderPlus, Grid3x3, ImageOff, Images, List, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { useDeveloperMode } from '@/lib/developer-mode';
import {
  useCreateMediaFolder,
  useDeleteMedia,
  useDeleteMediaFolder,
  useMediaFolders,
  useMediaList,
  useMoveMedia,
  useUpdateMedia,
  useUpdateMediaFolder,
  useUploadMedia,
  mediaFileUrl,
} from '@/lib/queries/media';
import { MediaDeveloperPanel } from '@/components/developer-panel/media-developer-panel';
import { ManageMediaFoldersDialog } from '@/components/manage-media-folders-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes } from '@/lib/format';
import type { AnyMediaContentType, Media, MediaContentType, MediaFolder } from '@/lib/types';
import { cn } from '@/lib/utils';

// The Media Library's default grid only ever shows public items (Phase 5: private assets,
// including every document type, are excluded from the default listing at the API layer, not
// filtered here) — but Media.contentType's own type is the full public+private union, so these
// maps cover every value that type can hold rather than only the ones this page ever actually
// renders.
const MEDIA_TYPE_LABELS: Record<AnyMediaContentType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
};

const MEDIA_TYPE_TONE: Record<AnyMediaContentType, string> = {
  'image/png': 'border-swatch-2/30 bg-swatch-2/14 text-swatch-2',
  'image/jpeg': 'border-swatch-4/30 bg-swatch-4/14 text-swatch-4',
  'image/gif': 'border-swatch-3/30 bg-swatch-3/14 text-swatch-3',
  'image/webp': 'border-swatch-5/30 bg-swatch-5/14 text-swatch-5',
  'application/pdf': 'border-swatch-1/30 bg-swatch-1/14 text-swatch-1',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'border-swatch-1/30 bg-swatch-1/14 text-swatch-1',
};

type TypeFilter = 'all' | MediaContentType;
type ViewMode = 'grid' | 'list';

function UploadMediaDialog({ defaultFolderId }: { defaultFolderId?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState('');
  const [folderId, setFolderId] = useState<string>(defaultFolderId ?? 'none');
  const [error, setError] = useState<string | null>(null);
  const uploadMedia = useUploadMedia();
  const { data: folders } = useMediaFolders();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError('Choose a file to upload');
      return;
    }

    try {
      await uploadMedia.mutateAsync({
        file,
        altText: altText || undefined,
        folderId: folderId === 'none' ? undefined : folderId,
      });
      toast.success('Media uploaded');
      setFile(null);
      setAltText('');
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to upload media';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setFolderId(defaultFolderId ?? 'none'); }}>
      <DialogTrigger asChild>
        <Button>Upload media</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload media</DialogTitle>
          <DialogDescription>
            PNG, JPEG, GIF or WebP, up to 10 MB (§14). The file's actual bytes decide its type
            — not the file extension.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="media-file">File</Label>
            <Input
              id="media-file"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="media-alt-text">Alt text (optional)</Label>
            <Input
              id="media-alt-text"
              value={altText}
              onChange={(event) => setAltText(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Folder</Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unfiled</SelectItem>
                {(folders ?? []).map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={uploadMedia.isPending}>
              {uploadMedia.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteMediaAlert({ item, trigger }: { item: Media; trigger: ReactNode }) {
  const deleteMedia = useDeleteMedia();

  async function handleDelete() {
    try {
      await deleteMedia.mutateAsync(item.id);
      toast.success('Media deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete media');
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{item.filename}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the file from storage. This cannot be undone.
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
  );
}

function RenameMediaDialog({ item, trigger }: { item: Media; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState(item.filename);
  const [altText, setAltText] = useState(item.altText ?? '');
  const [error, setError] = useState<string | null>(null);
  const updateMedia = useUpdateMedia();

  async function handleSave() {
    setError(null);
    if (!filename.trim()) {
      setError('Filename is required');
      return;
    }
    try {
      await updateMedia.mutateAsync({ id: item.id, filename: filename.trim(), altText: altText.trim() || null });
      toast.success('Media updated');
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update media');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setFilename(item.filename); setAltText(item.altText ?? ''); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            Renaming or re-describing this item never touches its file bytes or public URL.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="media-rename-filename">Filename</Label>
            <Input id="media-rename-filename" value={filename} onChange={(event) => setFilename(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="media-rename-alt-text">Alt text</Label>
            <Input id="media-rename-alt-text" value={altText} onChange={(event) => setAltText(event.target.value)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={() => void handleSave()} disabled={updateMedia.isPending}>
            {updateMedia.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediaThumbnail({ item, className }: { item: Media; className?: string }) {
  if (item.width && item.height) {
    return <img src={mediaFileUrl(item.id)} alt={item.altText ?? item.filename} className={className} />;
  }
  return (
    <div className={`flex items-center justify-center bg-muted ${className ?? ''}`}>
      <ImageOff className="size-5 text-muted-foreground" />
    </div>
  );
}

function MediaGrid({
  items,
  developerMode,
  onPreview,
  selectedIds,
  onToggleSelect,
}: {
  items: Media[];
  developerMode: boolean;
  onPreview: (item: Media) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((item) => {
        const selected = selectedIds.has(item.id);
        return (
          <Card key={item.id} size="sm" className={cn('group overflow-hidden py-0', selected && 'ring-2 ring-primary')}>
            <div
              role="button"
              tabIndex={0}
              className="relative block aspect-square w-full cursor-pointer overflow-hidden text-left"
              onClick={() => onPreview(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onPreview(item);
                }
              }}
              aria-label={`View ${item.filename} full size`}
            >
              <MediaThumbnail item={item} className="size-full object-cover transition-transform group-hover:scale-105" />
              {/* The dark wash is a hover-only visual flourish; the delete button itself stays
                  rendered and clickable without hovering first, so it's reachable on touch
                  devices, which have no hover state at all — subtly toned at rest, full
                  destructive-red only once hovered/focused. */}
              <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
              <button
                type="button"
                aria-label={selected ? `Deselect ${item.filename}` : `Select ${item.filename}`}
                aria-pressed={selected}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSelect(item.id);
                }}
                className={cn(
                  'absolute top-2 left-2 flex size-5 items-center justify-center rounded border bg-background/80 text-foreground transition-opacity',
                  selected ? 'border-primary bg-primary text-primary-foreground opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                {selected ? <Check className="size-3.5" /> : null}
              </button>
              <div className="absolute top-2 right-2 flex gap-1" onClick={(event) => event.stopPropagation()}>
                {developerMode ? (
                  <MediaDeveloperPanel
                    item={item}
                    className="bg-background/80 text-foreground hover:bg-background"
                  />
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label={`Manage ${item.filename}`}
                      className="bg-background/80 text-foreground hover:bg-background"
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <RenameMediaDialog
                      item={item}
                      trigger={
                        <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                          <Pencil /> Edit details
                        </DropdownMenuItem>
                      }
                    />
                    <DeleteMediaAlert
                      item={item}
                      trigger={
                        <DropdownMenuItem onSelect={(event) => event.preventDefault()} variant="destructive">
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      }
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <CardContent className="flex flex-col gap-1 pb-3">
              <p className="truncate text-sm font-medium">{item.filename}</p>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline" className={cn('text-[0.65rem]', MEDIA_TYPE_TONE[item.contentType])}>
                  {MEDIA_TYPE_LABELS[item.contentType]}
                </Badge>
                <span>
                  {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
                  {formatBytes(item.size)}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function MediaList({
  items,
  developerMode,
  onPreview,
  folders,
}: {
  items: Media[];
  developerMode: boolean;
  onPreview: (item: Media) => void;
  folders: MediaFolder[];
}) {
  const deleteMedia = useDeleteMedia();
  const moveMedia = useMoveMedia();

  const columns = useMemo<ColumnDef<Media>[]>(
    () => [
      {
        accessorKey: 'filename',
        header: 'File',
        cell: ({ row }) => (
          <button
            type="button"
            className="flex items-center gap-3 text-left"
            onClick={() => onPreview(row.original)}
            aria-label={`View ${row.original.filename} full size`}
          >
            <MediaThumbnail item={row.original} className="size-10 shrink-0 rounded-md object-cover" />
            <span className="font-medium hover:underline">{row.original.filename}</span>
          </button>
        ),
      },
      {
        accessorKey: 'contentType',
        header: 'Type',
        cell: ({ row }) => (
          <Badge variant="outline" className={MEDIA_TYPE_TONE[row.original.contentType]}>
            {MEDIA_TYPE_LABELS[row.original.contentType]}
          </Badge>
        ),
      },
      {
        id: 'dimensions',
        header: 'Dimensions',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.width && row.original.height ? `${row.original.width}×${row.original.height}` : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'size',
        header: 'Size',
        cell: ({ row }) => <span className="text-muted-foreground">{formatBytes(row.original.size)}</span>,
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        sortingFn: (rowA, rowB) =>
          new Date(rowA.original.updatedAt).getTime() - new Date(rowB.original.updatedAt).getTime(),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString()}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {developerMode ? <MediaDeveloperPanel item={row.original} /> : null}
            <RenameMediaDialog
              item={row.original}
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label={`Edit details for ${row.original.filename}`}>
                  <Pencil />
                </Button>
              }
            />
            <DeleteMediaAlert
              item={row.original}
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${row.original.filename}`}>
                  <Trash2 />
                </Button>
              }
            />
          </div>
        ),
      },
    ],
    [developerMode, onPreview],
  );

  return (
    <DataTable
      columns={columns}
      data={items}
      searchPlaceholder="Search media…"
      enableRowSelection
      bulkActions={(selected, clearSelection) => (
        <div className="flex gap-2">
          <Select
            onValueChange={(value) => {
              void moveMedia
                .mutateAsync({ mediaIds: selected.map((item) => item.id), folderId: value === 'none' ? null : value })
                .then(() => {
                  toast.success(`Moved ${selected.length} files`);
                  clearSelection();
                })
                .catch(() => toast.error('Failed to move files'));
            }}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder="Move to folder…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unfiled</SelectItem>
              {folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              const results = await Promise.allSettled(selected.map((item) => deleteMedia.mutateAsync(item.id)));
              const failed = results.filter((result) => result.status === 'rejected').length;
              if (failed === 0) toast.success(`${selected.length} files deleted`);
              else toast.error(`${failed} of ${selected.length} files failed to delete`);
              clearSelection();
            }}
          >
            <Trash2 />
            Delete
          </Button>
        </div>
      )}
    />
  );
}

function MediaPreviewDialog({ item, onOpenChange }: { item: Media | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="truncate">{item?.filename}</DialogTitle>
          {item ? (
            <DialogDescription>
              {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
              {formatBytes(item.size)} · {MEDIA_TYPE_LABELS[item.contentType]}
              {item.altText ? ` · ${item.altText}` : ''}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {item ? (
          <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-md bg-muted">
            <img
              src={mediaFileUrl(item.id)}
              alt={item.altText ?? item.filename}
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewMediaFolderButton({ parentId }: { parentId: string | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createFolder = useCreateMediaFolder();

  async function handleCreate() {
    if (!name.trim()) {
      setError('Enter a folder name');
      return;
    }
    setError(null);
    try {
      await createFolder.mutateAsync({ name: name.trim(), slug: slugify(name), parentId });
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
          <DialogDescription>
            {parentId ? 'Created inside the folder you currently have open.' : 'Created at the top level of the Media Library.'}
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Folder name"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void handleCreate()}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button onClick={() => void handleCreate()} disabled={createFolder.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function FolderCard({ folder, onOpen }: { folder: MediaFolder; onOpen: (id: string) => void }) {
  const updateFolder = useUpdateMediaFolder();
  const deleteFolder = useDeleteMediaFolder();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);

  async function handleRename() {
    if (!name.trim() || name === folder.name) {
      setRenaming(false);
      return;
    }
    try {
      await updateFolder.mutateAsync({ id: folder.id, name: name.trim(), slug: slugify(name) });
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
      toast.success('Folder deleted — its media is now unfiled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete folder');
    }
  }

  if (renaming) {
    return (
      <Card size="sm" className="p-3">
        <Input
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void handleRename()}
          onKeyDown={(event) => event.key === 'Enter' && void handleRename()}
        />
      </Card>
    );
  }

  return (
    <Card size="sm" className="group flex-row items-center justify-between gap-2 p-3">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => onOpen(folder.id)}
      >
        <Folder className="size-5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{folder.name}</span>
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
                  The folder is removed. Media inside it is never deleted — it becomes unfiled, and any
                  subfolders move to the top level.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DropdownMenuContent>
      </DropdownMenu>
    </Card>
  );
}

export function MediaLibraryPage() {
  const developerMode = useDeveloperMode();
  const { data: folders } = useMediaFolders();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const { data: mediaItems, isPending, error, refetch } = useMediaList({
    folderId: currentFolderId === null ? 'unfiled' : currentFolderId,
  });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [previewItem, setPreviewItem] = useState<Media | null>(null);
  const [managingFolders, setManagingFolders] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const moveMedia = useMoveMedia();
  const deleteMedia = useDeleteMedia();

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function navigateToFolder(id: string | null) {
    setSelectedIds(new Set());
    setCurrentFolderId(id);
  }

  const currentFolder = folders?.find((folder) => folder.id === currentFolderId) ?? null;
  const breadcrumbFolders = useMemo(() => {
    if (!folders) return [];
    const chain: MediaFolder[] = [];
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

  const typeFilteredItems = useMemo(
    () => (mediaItems ?? []).filter((item) => typeFilter === 'all' || item.contentType === typeFilter),
    [mediaItems, typeFilter],
  );

  const gridItems = useMemo(
    () => typeFilteredItems.filter((item) => item.filename.toLowerCase().includes(search.toLowerCase())),
    [typeFilteredItems, search],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Media' }]} />

      <PageHeader
        title="Media"
        description="Images available to use across your content."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setManagingFolders(true)}>
              <FolderCog />
              Manage folders
            </Button>
            <NewMediaFolderButton parentId={currentFolderId} />
            <UploadMediaDialog defaultFolderId={currentFolderId ?? undefined} />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <button type="button" className="flex items-center gap-1 hover:underline" onClick={() => navigateToFolder(null)}>
          <FolderOpen className="size-3.5" /> Media
        </button>
        {breadcrumbFolders.map((folder) => (
          <span key={folder.id} className="flex items-center gap-1">
            <span>/</span>
            <button type="button" className="hover:underline" onClick={() => navigateToFolder(folder.id)}>
              {folder.name}
            </button>
          </span>
        ))}
      </div>

      {subfolders.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {subfolders.map((folder) => (
            <FolderCard key={folder.id} folder={folder} onOpen={navigateToFolder} />
          ))}
        </div>
      ) : null}

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-square w-full" />
          ))}
        </div>
      ) : null}

      {mediaItems && mediaItems.length === 0 && subfolders.length === 0 ? (
        <EmptyState
          icon={Images}
          title={currentFolderId === null ? 'No unfiled media' : 'This folder is empty'}
          description="Upload an image to start using it in your content."
        />
      ) : null}

      {mediaItems && mediaItems.length > 0 ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {viewMode === 'grid' ? (
              <Input
                placeholder="Search media…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="max-w-sm"
              />
            ) : null}
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(MEDIA_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => void refetch()}>
              <RefreshCw />
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant={viewMode === 'grid' ? 'outline' : 'ghost'}
                size="icon-sm"
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
                onClick={() => setViewMode('grid')}
              >
                <Grid3x3 />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'outline' : 'ghost'}
                size="icon-sm"
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
              >
                <List />
              </Button>
            </div>
          </div>

          {viewMode === 'grid' && selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2">
              <span className="px-1 text-sm text-muted-foreground">{selectedIds.size} selected</span>
              <Select
                onValueChange={(value) => {
                  void moveMedia
                    .mutateAsync({ mediaIds: Array.from(selectedIds), folderId: value === 'none' ? null : value })
                    .then(() => {
                      toast.success(`Moved ${selectedIds.size} files`);
                      setSelectedIds(new Set());
                    })
                    .catch(() => toast.error('Failed to move files'));
                }}
              >
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue placeholder="Move to folder…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unfiled</SelectItem>
                  {(folders ?? []).map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  const ids = Array.from(selectedIds);
                  const results = await Promise.allSettled(ids.map((id) => deleteMedia.mutateAsync(id)));
                  const failed = results.filter((result) => result.status === 'rejected').length;
                  if (failed === 0) toast.success(`${ids.length} files deleted`);
                  else toast.error(`${failed} of ${ids.length} files failed to delete`);
                  setSelectedIds(new Set());
                }}
              >
                <Trash2 />
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
          ) : null}

          {viewMode === 'grid' ? (
            gridItems.length > 0 ? (
              <MediaGrid
                items={gridItems}
                developerMode={developerMode}
                onPreview={setPreviewItem}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No media matches your search.</p>
            )
          ) : (
            <MediaList items={typeFilteredItems} developerMode={developerMode} onPreview={setPreviewItem} folders={folders ?? []} />
          )}
        </div>
      ) : null}

      <MediaPreviewDialog item={previewItem} onOpenChange={(open) => !open && setPreviewItem(null)} />
      <ManageMediaFoldersDialog open={managingFolders} onOpenChange={setManagingFolders} />
    </div>
  );
}
