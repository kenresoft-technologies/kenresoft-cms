import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Grid3x3, ImageOff, Images, List, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { useDeleteMedia, useMediaList, useUploadMedia, mediaFileUrl } from '@/lib/queries/media';
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
import type { Media, MediaContentType } from '@/lib/types';

const MEDIA_TYPE_LABELS: Record<MediaContentType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
};

type TypeFilter = 'all' | MediaContentType;
type ViewMode = 'grid' | 'list';

function UploadMediaDialog() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const uploadMedia = useUploadMedia();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError('Choose a file to upload');
      return;
    }

    try {
      await uploadMedia.mutateAsync({ file, altText: altText || undefined });
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
    <Dialog open={open} onOpenChange={setOpen}>
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

function MediaGrid({ items }: { items: Media[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((item) => (
        <Card key={item.id} size="sm" className="group overflow-hidden py-0">
          <div className="relative aspect-square overflow-hidden">
            <MediaThumbnail item={item} className="size-full object-cover transition-transform group-hover:scale-105" />
            <div className="absolute inset-0 flex items-end justify-end bg-black/0 p-2 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
              <DeleteMediaAlert
                item={item}
                trigger={
                  <Button variant="destructive" size="icon-sm" aria-label={`Delete ${item.filename}`}>
                    <Trash2 />
                  </Button>
                }
              />
            </div>
          </div>
          <CardContent className="flex flex-col gap-1 pb-3">
            <p className="truncate text-sm font-medium">{item.filename}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-[0.65rem]">
                {MEDIA_TYPE_LABELS[item.contentType]}
              </Badge>
              <span>
                {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
                {formatBytes(item.size)}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MediaList({ items }: { items: Media[] }) {
  const deleteMedia = useDeleteMedia();

  const columns = useMemo<ColumnDef<Media>[]>(
    () => [
      {
        accessorKey: 'filename',
        header: 'File',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <MediaThumbnail item={row.original} className="size-10 shrink-0 rounded-md object-cover" />
            <span className="font-medium">{row.original.filename}</span>
          </div>
        ),
      },
      {
        accessorKey: 'contentType',
        header: 'Type',
        cell: ({ row }) => <Badge variant="outline">{MEDIA_TYPE_LABELS[row.original.contentType]}</Badge>,
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
          <DeleteMediaAlert
            item={row.original}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${row.original.filename}`}
                className="opacity-0 group-hover:opacity-100"
              >
                <Trash2 />
              </Button>
            }
          />
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={items}
      searchPlaceholder="Search media…"
      enableRowSelection
      bulkActions={(selected, clearSelection) => (
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
      )}
    />
  );
}

export function MediaLibraryPage() {
  const { data: mediaItems, isPending, error, refetch } = useMediaList();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

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
        actions={<UploadMediaDialog />}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-square w-full" />
          ))}
        </div>
      ) : null}

      {mediaItems && mediaItems.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No media yet"
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

          {viewMode === 'grid' ? (
            gridItems.length > 0 ? (
              <MediaGrid items={gridItems} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No media matches your search.</p>
            )
          ) : (
            <MediaList items={typeFilteredItems} />
          )}
        </div>
      ) : null}
    </div>
  );
}
