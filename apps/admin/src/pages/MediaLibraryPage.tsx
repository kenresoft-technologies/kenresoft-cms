import { useState, type FormEvent } from 'react';
import { ImageOff, Images, Trash2 } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import { useDeleteMedia, useMediaList, useUploadMedia, mediaFileUrl } from '@/lib/queries/media';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
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
import { Skeleton } from '@/components/ui/skeleton';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 1024 * 1024 ? 0 : 1)} ${bytes < 1024 * 1024 ? 'KB' : 'MB'}`;
}

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
      setFile(null);
      setAltText('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload media');
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

export function MediaLibraryPage() {
  const { data: mediaItems, isPending, error } = useMediaList();
  const deleteMedia = useDeleteMedia();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Media' }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Media</h1>
          <p className="text-muted-foreground">Images available to use across your content.</p>
        </div>
        <UploadMediaDialog />
      </div>

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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {mediaItems.map((item) => (
            <Card key={item.id} size="sm">
              {item.width && item.height ? (
                <img
                  src={mediaFileUrl(item.id)}
                  alt={item.altText ?? item.filename}
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-muted">
                  <ImageOff className="size-8 text-muted-foreground" />
                </div>
              )}
              <CardContent className="flex flex-col gap-1">
                <p className="truncate text-sm font-medium">{item.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
                  {formatSize(item.size)}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  disabled={deleteMedia.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete "${item.filename}"? This cannot be undone.`)) {
                      deleteMedia.mutate(item.id);
                    }
                  }}
                >
                  <Trash2 />
                  Delete
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
