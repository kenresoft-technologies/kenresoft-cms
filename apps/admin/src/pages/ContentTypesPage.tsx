import { useState, type FormEvent } from 'react';
import { ChevronRight, LayoutList, LayoutTemplate } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { apiClient, ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useContentTypes, useCreateContentType } from '@/lib/queries/content-types';
import { useFieldDefinitions } from '@/lib/queries/field-definitions';
import { roleAtLeast, type ContentType, type FieldDefinition, type FieldType, type UserRole } from '@/lib/types';
import { ContentTypeBadge } from '@/components/content-type-badge';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
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

function FieldsCountCell({ contentTypeId }: { contentTypeId: string }) {
  const { data: fields, isPending } = useFieldDefinitions(contentTypeId);
  if (isPending) return <span className="text-muted-foreground">…</span>;
  const count = fields?.length ?? 0;
  return (
    <Badge variant="secondary" className="font-normal">
      {count} {count === 1 ? 'field' : 'fields'}
    </Badge>
  );
}

const columns: ColumnDef<ContentType>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <Link to={`/content-types/${row.original.id}`} className="w-fit">
          <ContentTypeBadge id={row.original.id} name={row.original.name} />
        </Link>
        {row.original.description ? (
          <span className="max-w-xs truncate text-xs text-muted-foreground">{row.original.description}</span>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: 'slug',
    header: 'Slug',
    cell: ({ row }) => (
      <Badge variant="outline" className="font-mono font-normal text-muted-foreground">
        {row.original.slug}
      </Badge>
    ),
  },
  {
    id: 'fields',
    header: 'Fields',
    enableSorting: false,
    cell: ({ row }) => <FieldsCountCell contentTypeId={row.original.id} />,
  },
  {
    accessorKey: 'updatedAt',
    header: 'Updated',
    sortingFn: (rowA, rowB) =>
      new Date(rowA.original.updatedAt).getTime() - new Date(rowB.original.updatedAt).getTime(),
    cell: ({ row }) => (
      <span className="text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString()}</span>
    ),
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

interface ContentTypeTemplate {
  name: string;
  slug: string;
  description: string;
  fields: { name: string; label: string; fieldType: FieldType; required: boolean }[];
}

const CONTENT_TYPE_TEMPLATES: ContentTypeTemplate[] = [
  {
    name: 'Blog Post',
    slug: 'blog-post',
    description: 'Title, body, a featured image, and a publish date.',
    fields: [
      { name: 'title', label: 'Title', fieldType: 'text', required: true },
      { name: 'body', label: 'Body', fieldType: 'rich_text', required: true },
      { name: 'featured_image', label: 'Featured image', fieldType: 'media', required: false },
      { name: 'published_date', label: 'Published date', fieldType: 'date', required: false },
    ],
  },
  {
    name: 'Page',
    slug: 'page',
    description: 'A title and a body — for static pages like About or Contact.',
    fields: [
      { name: 'title', label: 'Title', fieldType: 'text', required: true },
      { name: 'body', label: 'Body', fieldType: 'rich_text', required: true },
    ],
  },
  {
    name: 'Service',
    slug: 'service',
    description: 'Title, description, an icon/image, and a starting price.',
    fields: [
      { name: 'title', label: 'Title', fieldType: 'text', required: true },
      { name: 'description', label: 'Description', fieldType: 'textarea', required: true },
      { name: 'icon', label: 'Icon / image', fieldType: 'media', required: false },
      { name: 'price', label: 'Starting price', fieldType: 'text', required: false },
    ],
  },
  {
    name: 'Team Member',
    slug: 'team-member',
    description: 'Name, role, a short bio, and a photo.',
    fields: [
      { name: 'name', label: 'Name', fieldType: 'text', required: true },
      { name: 'role', label: 'Role', fieldType: 'text', required: true },
      { name: 'bio', label: 'Bio', fieldType: 'textarea', required: false },
      { name: 'photo', label: 'Photo', fieldType: 'media', required: false },
    ],
  },
  {
    name: 'FAQ',
    slug: 'faq',
    description: 'A question and its answer.',
    fields: [
      { name: 'question', label: 'Question', fieldType: 'text', required: true },
      { name: 'answer', label: 'Answer', fieldType: 'rich_text', required: true },
    ],
  },
];

function ContentTypeTemplatesDialog() {
  const [open, setOpen] = useState(false);
  const [creatingSlug, setCreatingSlug] = useState<string | null>(null);
  const navigate = useNavigate();
  const createContentType = useCreateContentType();

  async function handleUseTemplate(template: ContentTypeTemplate) {
    setCreatingSlug(template.slug);
    try {
      const contentType = await createContentType.mutateAsync({ name: template.name, slug: template.slug });
      for (const field of template.fields) {
        // Sequential, not Promise.all — same reasoning as FormsPage's own ExamplesDialog:
        // sortOrder is assigned server-side from the current field count, so concurrent creates
        // would race. apiClient directly, not useCreateFieldDefinition — that hook binds to one
        // contentTypeId at render time, and this content type doesn't exist until just above.
        await apiClient.post<FieldDefinition>(`/api/v1/admin/content-types/${contentType.id}/fields`, field);
      }
      toast.success(`${template.name} content type created`);
      setOpen(false);
      void navigate(`/content-types/${contentType.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to create ${template.name}`);
    } finally {
      setCreatingSlug(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <LayoutTemplate />
          Examples
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start from a template</DialogTitle>
          <DialogDescription>
            Creates a real content type with these fields already added — edit or delete anything after.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {CONTENT_TYPE_TEMPLATES.map((template) => (
            <div key={template.slug} className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{template.name}</p>
                <p className="text-xs text-muted-foreground">{template.description}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={creatingSlug !== null}
                onClick={() => void handleUseTemplate(template)}
              >
                {creatingSlug === template.slug ? 'Creating…' : 'Use template'}
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const isAdmin = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'admin');
  const { data: contentTypes, isPending, error, refetch } = useContentTypes();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Content types' }]} />

      <PageHeader
        title="Content types"
        description="Reusable types such as Blog Post or Service."
        actions={
          isAdmin ? (
            <>
              <ContentTypeTemplatesDialog />
              <NewContentTypeDialog />
            </>
          ) : undefined
        }
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={4} />
          </Table>
        </div>
      ) : null}

      {contentTypes && contentTypes.length === 0 ? (
        <EmptyState
          icon={LayoutList}
          title="No content types yet"
          description={
            isAdmin
              ? 'Create one to start defining what your content looks like.'
              : 'Ask an admin to create a content type to get started.'
          }
        />
      ) : null}

      {contentTypes && contentTypes.length > 0 ? (
        <DataTable
          columns={columns}
          data={contentTypes}
          searchPlaceholder="Search content types…"
          onRowClick={(row) => navigate(`/content-types/${row.id}`)}
          onRefresh={() => void refetch()}
        />
      ) : null}
    </div>
  );
}
