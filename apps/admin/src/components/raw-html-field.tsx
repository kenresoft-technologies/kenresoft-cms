import { useEffect, useId, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { useRawHtmlAccess } from '@/lib/raw-html-access';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// The preview is untrusted-by-default: a fully sandboxed frame (no scripts, no same-origin, no
// forms/popups) with its own CSP, showing the SERVER-SANITIZED result — exactly what would be
// stored and published — never the pasted markup itself.
function buildPreviewDocument(sanitizedHtml: string) {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: http:; style-src \'unsafe-inline\'">' +
    '<style>body{font-family:system-ui,sans-serif;margin:12px;line-height:1.5}img{max-width:100%}</style>' +
    `</head><body>${sanitizedHtml}</body></html>`
  );
}

interface RawHtmlFieldProps {
  label: string;
  value: string;
  onChange: (html: string) => void;
}

export function RawHtmlField({ label, value, onChange }: RawHtmlFieldProps) {
  const id = useId();
  const { enabled, isAdmin } = useRawHtmlAccess();
  const canEdit = enabled && isAdmin;
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  // Debounced round trip to the server's sanitizer. The result is what the frame renders.
  useEffect(() => {
    if (!canEdit) return;
    const handle = setTimeout(() => {
      apiClient
        .post<{ html: string }>('/api/v1/admin/pages/sanitize-html', { html: value })
        .then((result) => {
          setPreview(result.html);
          setPreviewError(false);
        })
        .catch(() => setPreviewError(true));
    }, 400);
    return () => clearTimeout(handle);
  }, [value, canEdit]);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <p>
          Raw HTML is cleaned on the server before it is saved and again before it is published:
          scripts, iframes, forms, event handlers, unsafe links and positioning styles are removed.
          What you see in the preview is exactly what will be published.
        </p>
      </div>

      {!enabled ? (
        <p className="text-sm text-muted-foreground">
          Raw HTML blocks are turned off for this deployment. An admin can enable them in Settings → API.
        </p>
      ) : !isAdmin ? (
        <p className="text-sm text-muted-foreground">Only an admin or owner can edit a Raw HTML block.</p>
      ) : (
        <>
          <Textarea
            id={id}
            value={value}
            spellCheck={false}
            placeholder="<section>Paste HTML here</section>"
            className="min-h-40 font-mono text-sm"
            onChange={(event) => onChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Preview (sanitized)</p>
          <iframe
            title="Sanitized HTML preview"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={buildPreviewDocument(preview ?? '')}
            className="h-56 w-full rounded-md border bg-white"
          />
          {previewError ? (
            <p className="text-xs text-destructive">Couldn&apos;t load the sanitized preview.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
