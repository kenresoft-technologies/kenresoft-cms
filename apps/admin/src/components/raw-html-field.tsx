import { useId } from 'react';
import { ShieldAlert } from 'lucide-react';

import { useRawHtmlAccess } from '@/lib/raw-html-access';
import { Label } from '@/components/ui/label';
import { SanitizedHtmlPreview } from '@/components/sanitized-html-preview';
import { Textarea } from '@/components/ui/textarea';

interface RawHtmlFieldProps {
  label: string;
  value: string;
  onChange: (html: string) => void;
}

export function RawHtmlField({ label, value, onChange }: RawHtmlFieldProps) {
  const id = useId();
  const { enabled, isAdmin } = useRawHtmlAccess();

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
          <SanitizedHtmlPreview html={value} endpoint="/api/v1/admin/pages/sanitize-html" />
        </>
      )}
    </div>
  );
}
