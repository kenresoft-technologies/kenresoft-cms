import { useMemo, useState, type FormEvent } from 'react';
import { ChevronRight, FileText, Grid3x3, LayoutList, LayoutTemplate, ListTree, Rows } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { apiClient, ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useContentTypesWithCounts, useCreateContentType } from '@/lib/queries/content-types';
import { roleAtLeast, type ContentTypeWithCounts, type FieldDefinition, type FieldType, type UserRole } from '@/lib/types';
import { ContentTypeBadge } from '@/components/content-type-badge';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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

type ViewMode = 'grid' | 'table';
const VIEW_MODE_STORAGE_KEY = 'content-types-view-mode';

function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === 'table' ? 'table' : 'grid';
  } catch {
    return 'grid';
  }
}

const columns: ColumnDef<ContentTypeWithCounts>[] = [
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
    cell: ({ row }) => (
      <Badge variant="secondary" className="font-normal">
        {row.original.fieldCount} {row.original.fieldCount === 1 ? 'field' : 'fields'}
      </Badge>
    ),
  },
  {
    id: 'entries',
    header: 'Entries',
    enableSorting: false,
    cell: ({ row }) => (
      <Badge variant="outline" className="font-normal">
        {row.original.entryCount} {row.original.entryCount === 1 ? 'entry' : 'entries'}
      </Badge>
    ),
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
      // Schema, not Entries — the fields just created are the thing worth reviewing next.
      void navigate(`/content-types/${contentType.id}/schema`);
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
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const contentType = await createContentType.mutateAsync({ name, slug });
      toast.success('Content type created');
      setName('');
      setSlug('');
      setOpen(false);
      // Schema, not Entries — a brand-new content type has no fields yet, so adding fields is
      // the useful next step, not an empty entries list.
      void navigate(`/content-types/${contentType.id}/schema`);
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

function ContentTypeCard({ contentType }: { contentType: ContentTypeWithCounts }) {
  return (
    // The card's own click target is Entries — the actual content/data — not the schema. A
    // secondary "Schema" link sits inside, stopping propagation so it navigates independently
    // rather than also triggering the card's own Entries link underneath it.
    <Link to={`/content-types/${contentType.id}`} className="block h-full">
      <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="min-w-0">
            <ContentTypeBadge id={contentType.id} name={contentType.name} />
            <p className="mt-1 font-mono text-xs text-muted-foreground">{contentType.slug}</p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
            {contentType.description ?? 'No description.'}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-normal">
                <ListTree /> {contentType.fieldCount} {contentType.fieldCount === 1 ? 'field' : 'fields'}
              </Badge>
              <Badge variant="outline" className="font-normal">
                <FileText /> {contentType.entryCount} {contentType.entryCount === 1 ? 'entry' : 'entries'}
              </Badge>
            </div>
            <Link
              to={`/content-types/${contentType.id}/schema`}
              onClick={(event) => event.stopPropagation()}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Schema
            </Link>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function ContentTypesPage() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const isAdmin = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'admin');
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [search, setSearch] = useState('');
  const withCounts = useContentTypesWithCounts();
  const { data: contentTypes, isPending, error, refetch } = withCounts;

  function setMode(mode: ViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      /* per-viewer convenience only — ignore if storage is unavailable */
    }
  }

  const filteredForGrid = useMemo(() => {
    const rows = (withCounts.data ?? []) as ContentTypeWithCounts[];
    if (!search.trim()) return rows;
    const query = search.toLowerCase();
    return rows.filter(
      (row) => row.name.toLowerCase().includes(query) || row.slug.toLowerCase().includes(query),
    );
  }, [withCounts.data, search]);

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Content types' }]} />

      <PageHeader
        title="Content types"
        description="Reusable types such as Blog Post or Service."
        actions={
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <>
                <ContentTypeTemplatesDialog />
                <NewContentTypeDialog />
              </>
            ) : null}
            <div className="ml-1 flex items-center gap-1 rounded-lg border p-0.5">
              <Button
                variant={viewMode === 'grid' ? 'outline' : 'ghost'}
                size="icon-sm"
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
                onClick={() => setMode('grid')}
              >
                <Grid3x3 />
              </Button>
              <Button
                variant={viewMode === 'table' ? 'outline' : 'ghost'}
                size="icon-sm"
                aria-label="Table view"
                aria-pressed={viewMode === 'table'}
                onClick={() => setMode('table')}
              >
                <Rows />
              </Button>
            </div>
          </div>
        }
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl border bg-muted/40" />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Fields</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableSkeleton columns={5} />
            </Table>
          </div>
        )
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

      {viewMode === 'grid' && withCounts.data && withCounts.data.length > 0 ? (
        <div className="flex flex-col gap-4">
          <Input
            placeholder="Search content types…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-sm"
          />
          {filteredForGrid.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredForGrid.map((contentType) => (
                <ContentTypeCard key={contentType.id} contentType={contentType} />
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No content types match your search.</p>
          )}
        </div>
      ) : null}

      {viewMode === 'table' && contentTypes && contentTypes.length > 0 ? (
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
