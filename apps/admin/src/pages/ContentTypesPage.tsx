import { useState, type FormEvent } from 'react';
import { ChevronRight, LayoutList } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useContentTypes, useCreateContentType } from '@/lib/queries/content-types';
import type { ContentType } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

const columns: ColumnDef<ContentType>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <Link to={`/content-types/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: 'slug',
    header: 'Slug',
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.slug}</span>,
  },
  {
    id: 'chevron',
    header: '',
    enableSorting: false,
    cell: () => (
      <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    ),
  },
];

function NewContentTypeDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createContentType = useCreateContentType();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await createContentType.mutateAsync({ name, slug });
      toast.success('Content type created');
      setName('');
      setSlug('');
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create content type';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New content type</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New content type</DialogTitle>
          <DialogDescription>
            A reusable type such as Blog Post or Service (§6). Add fields to it next.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="content-type-name">Name</Label>
            <Input
              id="content-type-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="content-type-slug">Slug</Label>
            <Input
              id="content-type-slug"
              required
              placeholder="blog-post"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createContentType.isPending}>
              {createContentType.isPending ? 'Creating…' : 'Create content type'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ContentTypesPage() {
  const { data: session } = authClient.useSession();
  const isOwner = session?.user.role === 'owner';
  const { data: contentTypes, isPending, error } = useContentTypes();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Content types' }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Content types</h1>
          <p className="text-muted-foreground">Reusable types such as Blog Post or Service.</p>
        </div>
        {isOwner ? <NewContentTypeDialog /> : null}
      </div>

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={2} />
          </Table>
        </div>
      ) : null}

      {contentTypes && contentTypes.length === 0 ? (
        <EmptyState
          icon={LayoutList}
          title="No content types yet"
          description={
            isOwner
              ? 'Create one to start defining what your content looks like.'
              : 'Ask an owner to create a content type to get started.'
          }
        />
      ) : null}

      {contentTypes && contentTypes.length > 0 ? (
        <DataTable columns={columns} data={contentTypes} searchPlaceholder="Search content types…" />
      ) : null}
    </div>
  );
}
