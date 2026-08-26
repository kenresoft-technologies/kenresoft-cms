import { useState, type FormEvent } from 'react';
import { ChevronRight, LayoutList } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { ApiError } from '@/lib/api-client';
import { useProject } from '@/lib/queries/projects';
import { useContentTypes, useCreateContentType } from '@/lib/queries/content-types';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function NewContentTypeDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createContentType = useCreateContentType(projectId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await createContentType.mutateAsync({ name, slug });
      setName('');
      setSlug('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create content type');
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
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId ?? '');
  const { data: contentTypes, isPending, error } = useContentTypes(projectId ?? '');

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Projects', to: '/projects' },
          { label: project?.name ?? '…' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Content types</h1>
          <p className="text-muted-foreground">Reusable types such as Blog Post or Service.</p>
        </div>
        {projectId ? <NewContentTypeDialog projectId={projectId} /> : null}
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
          description="Create one to start defining what this project's content looks like."
        />
      ) : null}

      {contentTypes && contentTypes.length > 0 ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contentTypes.map((contentType) => (
                <TableRow key={contentType.id} className="group">
                  <TableCell>
                    <Link
                      to={`/projects/${projectId}/content-types/${contentType.id}`}
                      className="font-medium hover:underline"
                    >
                      {contentType.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{contentType.slug}</TableCell>
                  <TableCell>
                    <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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
