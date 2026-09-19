import { useState, type ReactNode } from 'react';
import { ImageOff, Search } from 'lucide-react';

import { mediaFileUrl, useMediaFolders, useMediaList } from '@/lib/queries/media';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface MediaPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId?: string | undefined;
  // Receives the chosen media's id and, for callers that need it (e.g. inserting an image), its
  // display name.
  onSelect: (mediaId: string, item: { filename: string; altText: string | null }) => void;
  trigger: ReactNode;
  title?: string;
}

// Shared by every "choose from the Media Library" picker (media-type fields, product images,
// the rich-text editor's Insert image). A roomy dialog with its own scrolling grid and a filename
// search, so a large library stays usable. Tiles are squares built with the padding-top trick
// (not aspect-ratio + percentage heights), which sizes them from their width alone — the thing
// that used to make thumbnails collapse onto each other inside a scroll container.
export function MediaPickerDialog({
  open,
  onOpenChange,
  selectedId,
  onSelect,
  trigger,
  title = 'Choose media',
}: MediaPickerDialogProps) {
  const [folderId, setFolderId] = useState('all');
  const [search, setSearch] = useState('');
  const { data: folders } = useMediaFolders();
  const { data: mediaItems } = useMediaList({ folderId: folderId === 'all' ? undefined : folderId });

  const query = search.trim().toLowerCase();
  const visible = (mediaItems ?? []).filter((item) => !query || item.filename.toLowerCase().includes(query));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="xl" className="flex h-[85vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by file name…"
              aria-label="Search media"
              className="pl-8"
            />
          </div>
          {folders && folders.length > 0 ? (
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger className="w-44" aria-label="Folder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All folders</SelectItem>
                <SelectItem value="unfiled">Unfiled</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {visible.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.filename}
                  onClick={() => {
                    onSelect(item.id, { filename: item.filename, altText: item.altText ?? null });
                    onOpenChange(false);
                  }}
                  className="group flex flex-col gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      'relative block w-full overflow-hidden rounded-md bg-muted pt-[100%] ring-2 ring-transparent group-hover:ring-primary',
                      item.id === selectedId && 'ring-primary',
                    )}
                  >
                    {item.width && item.height ? (
                      <img
                        src={mediaFileUrl(item.id)}
                        alt={item.altText ?? item.filename}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <ImageOff className="size-5 text-muted-foreground" />
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{item.filename}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {mediaItems && mediaItems.length > 0 ? 'No media matches your search.' : 'No media uploaded yet.'}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
