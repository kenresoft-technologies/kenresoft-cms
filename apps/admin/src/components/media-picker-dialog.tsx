import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Search } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import {
  mediaFileUrl,
  picsumThumbnailUrl,
  useImportExternalMedia,
  useMediaFolders,
  useMediaList,
  usePicsumCatalog,
  type PicsumPhoto,
} from '@/lib/queries/media';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

// Picsum needs no API key (unlike a Pixabay/Unsplash-style provider would), which is exactly why
// it's the one external source implemented so far — see IMPORT_MEDIA_SOURCES's own comment in
// packages/contracts/schemas/media.ts. The image is downloaded and stored in R2 like a normal
// upload before onSelect ever fires, so the caller always receives a real, already-persisted
// media id, identical to picking an existing library item.
//
// Two steps, not one blind fetch: browse real photos from Picsum's own catalog (thumbnails,
// author credit, pagination) and preview the actual selection full-size before importing —
// the original version imported an unseen, un-chosen random/seeded photo on a single click.
function PicsumImportTab({
  onImported,
}: {
  onImported: (mediaId: string, item: { filename: string; altText: string | null }) => void;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PicsumPhoto | null>(null);
  const [width, setWidth] = useState('800');
  const [height, setHeight] = useState('600');
  const [altText, setAltText] = useState('');
  const { data: photos, isLoading, isError } = usePicsumCatalog(page);
  const importMedia = useImportExternalMedia();

  function choose(photo: PicsumPhoto) {
    setSelected(photo);
    // Default the import size to the photo's own aspect ratio at a reasonable resolution,
    // rather than always forcing whatever the previous selection's width/height happened to be.
    const scale = 900 / photo.width;
    setWidth(String(Math.round(photo.width * scale)));
    setHeight(String(Math.round(photo.height * scale)));
    setAltText(`Photo by ${photo.author} via Picsum`);
  }

  function handleImport() {
    if (!selected) return;
    const widthNum = Number(width);
    const heightNum = Number(height);
    if (!widthNum || !heightNum) return;

    importMedia.mutate(
      {
        source: 'picsum',
        width: widthNum,
        height: heightNum,
        pictureId: selected.id,
        altText: altText.trim() || undefined,
      },
      {
        onSuccess: (media) => {
          toast.success('Image imported from Picsum');
          onImported(media.id, { filename: media.filename, altText: media.altText });
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed to import image'),
      },
    );
  }

  if (selected) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Back to browsing
        </button>
        <div className="overflow-hidden rounded-md bg-muted">
          <img
            src={picsumThumbnailUrl(selected.id, 700)}
            alt={`Preview by ${selected.author}`}
            className="mx-auto max-h-72 w-full object-contain"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Photo by {selected.author} — original {selected.width}×{selected.height}px
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="picsum-width">Import width</Label>
            <Input id="picsum-width" type="number" min={1} max={5000} value={width} onChange={(e) => setWidth(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="picsum-height">Import height</Label>
            <Input id="picsum-height" type="number" min={1} max={5000} value={height} onChange={(e) => setHeight(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="picsum-alt">Alt text</Label>
          <Input id="picsum-alt" value={altText} onChange={(e) => setAltText(e.target.value)} />
        </div>
        <Button type="button" onClick={handleImport} disabled={importMedia.isPending} className="self-start">
          {importMedia.isPending ? 'Importing…' : 'Import this photo'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-sm text-muted-foreground">
        Browse free stock photos from{' '}
        <a href="https://picsum.photos" target="_blank" rel="noreferrer" className="underline">
          Picsum
        </a>{' '}
        — pick one to preview, then import it into your own Media Library (downloaded and stored, not hot-linked).
      </p>
      {isError ? (
        <p className="text-sm text-destructive">Couldn't reach Picsum. Check your connection and try again.</p>
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-md" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {(photos ?? []).map((photo) => (
            <button
              key={photo.id}
              type="button"
              title={`Photo by ${photo.author}`}
              onClick={() => choose(photo)}
              className="group relative block aspect-square w-full overflow-hidden rounded-md bg-muted ring-2 ring-transparent outline-none focus-visible:ring-primary group-hover:ring-primary"
            >
              <img
                src={picsumThumbnailUrl(photo.id, 300)}
                alt={`Photo by ${photo.author}`}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
              />
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[11px] text-white opacity-0 group-hover:opacity-100">
                {photo.author}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
          <ChevronLeft className="size-4" /> Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {page}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
          Next <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
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
        <Tabs defaultValue="library" className="flex min-h-0 flex-1 flex-col gap-3">
          <TabsList>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="picsum">From Picsum</TabsTrigger>
          </TabsList>
          <TabsContent value="library" className="flex min-h-0 flex-1 flex-col gap-3">
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
          </TabsContent>
          <TabsContent value="picsum" className="min-h-0 flex-1 overflow-y-auto pr-1">
            <PicsumImportTab
              onImported={(mediaId, item) => {
                onSelect(mediaId, item);
                onOpenChange(false);
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
