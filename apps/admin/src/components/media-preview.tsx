import { useState } from 'react';
import { ImageOff } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// A thumbnail that opens a larger preview of the chosen Media Library file when clicked, so an
// editor can see what they picked (an app icon, a hero image) without leaving the entry form.
// `src` is the admin-gated file URL the thumbnail already uses.
export function MediaPreview({ src, name }: { src: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex size-16 items-center justify-center rounded-md bg-muted" title="No preview available">
        <ImageOff className="size-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Preview ${name}`}
        className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <img
          src={src}
          alt=""
          onError={() => setFailed(true)}
          className="size-16 rounded-md object-cover transition hover:opacity-80"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-all">{name}</DialogTitle>
            <DialogDescription>The file as it is stored in your Media Library.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center rounded-lg bg-muted p-3">
            <img src={src} alt={name} className="max-h-[60vh] max-w-full rounded-md object-contain" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
