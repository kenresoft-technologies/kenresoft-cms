import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// No syntax highlighter is installed anywhere in the admin app (confirmed: no shiki/prism/
// highlight.js dependency) — this stays a plain monospace block rather than pulling one in
// for a single feature.
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by the browser — the code is still visible and
      // selectable, so there's nothing else useful to do here.
    }
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border bg-muted/40', className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
          {label ?? 'Code'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => void handleCopy()}
        >
          {copied ? (
            <>
              <Check className="text-success" />
              Copied
            </>
          ) : (
            <>
              <Copy />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[0.8rem] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
