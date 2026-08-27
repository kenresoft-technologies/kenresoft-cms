import { useState } from 'react';

import { mediaFileUrl, useMediaList } from '@/lib/queries/media';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function AvatarPickerDialog({ onSelect }: { onSelect: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: mediaItems } = useMediaList();
  const pickable = mediaItems?.filter((item) => item.width && item.height) ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Change avatar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose an avatar</DialogTitle>
          <DialogDescription>Pick an image from your media library.</DialogDescription>
        </DialogHeader>
        {pickable.length === 0 ? (
          <p className="text-sm text-muted-foreground">Upload an image in Media first.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {pickable.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Use ${item.filename} as avatar`}
                className="aspect-square overflow-hidden rounded-lg border hover:border-primary"
                onClick={() => {
                  onSelect(mediaFileUrl(item.id));
                  setOpen(false);
                }}
              >
                <img
                  src={mediaFileUrl(item.id)}
                  alt={item.altText ?? item.filename}
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
