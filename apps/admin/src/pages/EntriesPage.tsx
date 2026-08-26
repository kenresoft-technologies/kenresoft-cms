import { FileText, Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { useContentType } from '@/lib/queries/content-types';
import { useEntries } from '@/lib/queries/entries';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function EntriesPage() {
  const { contentTypeId } = useParams<{ contentTypeId: string }>();
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: entries, isPending, error } = useEntries(contentTypeId ?? '');

  const newEntryLink = (
    <Button asChild>
      <Link to={`/content-types/${contentTypeId}/entries/new`}>
        <Plus />
        New entry
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Content types', to: '/content-types' },
          { label: contentType?.name ?? '…', to: `/content-types/${contentTypeId}` },
          { label: 'Entries' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Entries</h1>
          <p className="text-muted-foreground">
            {contentType ? `Instances of ${contentType.name}.` : 'Content instances.'}
          </p>
        </div>
        {newEntryLink}
      </div>

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={3} />
          </Table>
        </div>
      ) : null}

      {entries && entries.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No entries yet"
          description="Create your first entry for this content type."
        />
      ) : null}

      {entries && entries.length > 0 ? (
        <div className="rounded-xl border">
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
                      to={`/content-types/${contentTypeId}/entries/${entry.id}`}
                      className="font-medium hover:underline"
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
        </div>
      ) : null}
    </div>
  );
}
