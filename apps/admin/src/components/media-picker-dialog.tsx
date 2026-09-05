import type { ReactNode } from 'react';
import { ImageOff } from 'lucide-react';

import { mediaFileUrl, useMediaList } from '@/lib/queries/media';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface MediaPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId?: string | undefined;
  onSelect: (mediaId: string) => void;
  trigger: ReactNode;
}

// Extracted from field-input.tsx's MediaField (the media-type content-type field), which used
// this exact dialog+grid inline — pulled out so a second consumer (Commerce's product image
// picker) can share the same implementation rather than duplicating it.
export function MediaPickerDialog({ open, onOpenChange, selectedId, onSelect, trigger }: MediaPickerDialogProps) {
  const { data: mediaItems } = useMediaList();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose media</DialogTitle>
        </DialogHeader>
        {mediaItems && mediaItems.length > 0 ? (
          <div className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto">
            {mediaItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  onOpenChange(false);
                }}
                className={cn(
                  'aspect-square overflow-hidden rounded-md ring-2 ring-transparent hover:ring-primary',
                  item.id === selectedId && 'ring-primary',
                )}
              >
                {item.width && item.height ? (
                  <img
                    src={mediaFileUrl(item.id)}
                    alt={item.altText ?? item.filename}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-muted">
                    <ImageOff className="size-5 text-muted-foreground" />
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No media uploaded yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
