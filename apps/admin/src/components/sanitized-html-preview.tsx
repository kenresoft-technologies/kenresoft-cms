import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

// The preview is untrusted-by-default: a fully sandboxed frame (no scripts, no same-origin, no
// forms/popups) with its own CSP, showing the SERVER-SANITIZED result — exactly what would be
// stored/published/sent — never the pasted markup itself.
function buildPreviewDocument(sanitizedHtml: string) {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: http:; style-src \'unsafe-inline\'">' +
    '<style>body{font-family:system-ui,sans-serif;margin:12px;line-height:1.5}img{max-width:100%}</style>' +
    `</head><body>${sanitizedHtml}</body></html>`
  );
}

interface SanitizedHtmlPreviewProps {
  html: string;
  // The admin endpoint that returns `{ html }` — the server's own sanitizer for this content type.
  endpoint: string;
  heightClass?: string;
}

export function SanitizedHtmlPreview({ html, endpoint, heightClass = 'h-56' }: SanitizedHtmlPreviewProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // Debounced round trip to the server's sanitizer. The result is what the frame renders.
  useEffect(() => {
    const handle = setTimeout(() => {
      apiClient
        .post<{ html: string }>(endpoint, { html })
        .then((result) => {
          setPreview(result.html);
          setError(false);
        })
        .catch(() => setError(true));
    }, 400);
    return () => clearTimeout(handle);
  }, [html, endpoint]);

  return (
    <>
      <p className="text-xs text-muted-foreground">Preview (sanitized)</p>
      <iframe
        title="Sanitized HTML preview"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={buildPreviewDocument(preview ?? '')}
        className={`${heightClass} w-full rounded-md border bg-white`}
      />
      {error ? <p className="text-xs text-destructive">Couldn&apos;t load the sanitized preview.</p> : null}
    </>
  );
}
