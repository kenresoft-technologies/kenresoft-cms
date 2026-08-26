import { useMemo } from 'react';
import { FileText, Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';

import { useContentType } from '@/lib/queries/content-types';
import { useEntries } from '@/lib/queries/entries';
import type { Entry } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

export function EntriesPage() {
  const { contentTypeId } = useParams<{ contentTypeId: string }>();
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: entries, isPending, error } = useEntries(contentTypeId ?? '');

  const columns = useMemo<ColumnDef<Entry>[]>(
    () => [
      {
        accessorKey: 'slug',
        header: 'Slug',
        cell: ({ row }) => (
          <Link
            to={`/content-types/${contentTypeId}/entries/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {row.original.slug}
          </Link>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'published' ? 'default' : 'secondary'}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        sortingFn: (rowA, rowB) =>
          new Date(rowA.original.updatedAt).getTime() - new Date(rowB.original.updatedAt).getTime(),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{new Date(row.original.updatedAt).toLocaleString()}</span>
        ),
      },
    ],
    [contentTypeId],
  );

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
        <DataTable columns={columns} data={entries} searchPlaceholder="Search entries…" />
      ) : null}
    </div>
  );
}
