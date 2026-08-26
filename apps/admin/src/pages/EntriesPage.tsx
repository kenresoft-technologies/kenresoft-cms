import { Link, useParams } from 'react-router';

import { useContentType } from '@/lib/queries/content-types';
import { useEntries } from '@/lib/queries/entries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function EntriesPage() {
  const { projectId, contentTypeId } = useParams<{ projectId: string; contentTypeId: string }>();
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: entries, isPending, error } = useEntries(contentTypeId ?? '');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to={`/projects/${projectId}/content-types/${contentTypeId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← {contentType?.name ?? 'Content type'}
          </Link>
          <h1 className="text-2xl font-semibold">Entries</h1>
        </div>
        <Button asChild>
          <Link to={`/projects/${projectId}/content-types/${contentTypeId}/entries/new`}>
            New entry
          </Link>
        </Button>
      </div>

      {isPending ? <p className="text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-destructive">{error.message}</p> : null}

      {entries && entries.length === 0 ? (
        <p className="text-muted-foreground">No entries yet — create one to get started.</p>
      ) : null}

      {entries && entries.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <Link
                    to={`/projects/${projectId}/content-types/${contentTypeId}/entries/${entry.id}`}
                    className="text-primary hover:underline"
                  >
                    {entry.slug}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={entry.status === 'published' ? 'default' : 'secondary'}>
                    {entry.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(entry.updatedAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
