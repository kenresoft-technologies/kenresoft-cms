import { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';

import { useEmailLimits } from '@/lib/queries/email';
import { useMediaList } from '@/lib/queries/media';
import { Button } from '@/components/ui/button';
import { MediaPickerDialog } from '@/components/media-picker-dialog';

import type { AttachmentState } from '@/lib/queries/email';

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Attach from disk or from the Media Library. Media selections are sent as ids and read
// server-side under the caller's session — the file is never made public. Type checking is done
// server-side by the file's real bytes; this only pre-checks count and total size against the
// provider limits the server reports, so an over-limit send is caught before uploading.
export function EmailAttachments({
  value,
  onChange,
}: {
  value: AttachmentState;
  onChange: (next: AttachmentState) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: limits } = useEmailLimits();
  const { data: media } = useMediaList();

  const mediaById = new Map((media ?? []).map((item) => [item.id, item]));
  const total =
    value.files.reduce((sum, file) => sum + file.size, 0) +
    value.mediaIds.reduce((sum, id) => sum + (mediaById.get(id)?.size ?? 0), 0);
  const count = value.files.length + value.mediaIds.length;
  const overSize = limits ? total > limits.maxTotalBytes : false;
  const overCount = limits ? count > limits.maxFiles : false;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.docx,image/png,image/jpeg,image/gif,image/webp"
          aria-label="Attach files"
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            if (picked.length) onChange({ ...value, files: [...value.files, ...picked] });
            event.target.value = '';
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <Paperclip />
          Attach files
        </Button>
        <MediaPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={(id) => {
            if (!value.mediaIds.includes(id)) onChange({ ...value, mediaIds: [...value.mediaIds, id] });
            setPickerOpen(false);
          }}
          trigger={
            <Button type="button" variant="outline" size="sm">
              From Media Library
            </Button>
          }
        />
        {limits ? (
          <span className={overSize || overCount ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {count} / {limits.maxFiles} files · {formatSize(total)} of {formatSize(limits.maxTotalBytes)}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">PDF, DOCX and images (PNG, JPEG, GIF, WebP).</p>
      {count > 0 ? (
        <ul className="flex flex-col gap-1">
          {value.files.map((file, index) => (
            <li key={`f-${index}`} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
              <span className="truncate">
                {file.name} <span className="text-muted-foreground">({formatSize(file.size)})</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange({ ...value, files: value.files.filter((_, i) => i !== index) })}
              >
                <X />
              </Button>
            </li>
          ))}
          {value.mediaIds.map((id) => {
            const item = mediaById.get(id);
            const name = item?.filename ?? 'Media file';
            return (
              <li key={`m-${id}`} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
                <span className="truncate">
                  {name} <span className="text-muted-foreground">(Media Library)</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${name}`}
                  onClick={() => onChange({ ...value, mediaIds: value.mediaIds.filter((m) => m !== id) })}
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {overSize || overCount ? (
        <p className="text-sm text-destructive">Attachments exceed this email provider&apos;s limits.</p>
      ) : null}
    </div>
  );
}
