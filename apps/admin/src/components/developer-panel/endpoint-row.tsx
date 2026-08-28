import { Badge } from '@/components/ui/badge';

const METHOD_CLASSES: Record<'GET' | 'POST', string> = {
  GET: 'border-success/25 bg-success/12 text-success dark:bg-success/20',
  POST: 'border-primary/25 bg-primary/12 text-primary dark:bg-primary/20',
};

export function EndpointRow({
  method,
  path,
  summary,
  note,
}: {
  method: 'GET' | 'POST';
  path: string;
  summary?: string | undefined;
  note?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={METHOD_CLASSES[method]}>
          {method}
        </Badge>
        <code className="font-mono text-xs break-all">{path}</code>
        <Badge variant="outline" className="ml-auto">
          No auth required
        </Badge>
      </div>
      {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
