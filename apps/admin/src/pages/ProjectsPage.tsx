import { useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api-client';
import { useCreateProject, useProjects } from '@/lib/queries/projects';
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

function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createProject = useCreateProject();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await createProject.mutateAsync({ name, slug });
      setName('');
      setSlug('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create project');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Projects are the top-level boundary for content types, entries, and media (§11).
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-slug">Slug</Label>
            <Input
              id="project-slug"
              required
              placeholder="pathvera"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createProject.isPending}>
              {createProject.isPending ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const { data: projects, isPending, error } = useProjects();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-muted-foreground">Every content type and entry belongs to a project.</p>
        </div>
        <NewProjectDialog />
      </div>

      {isPending ? <p className="text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-destructive">{error.message}</p> : null}

      {projects && projects.length === 0 ? (
        <p className="text-muted-foreground">No projects yet — create one to get started.</p>
      ) : null}

      {projects && projects.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell>{project.name}</TableCell>
                <TableCell className="text-muted-foreground">{project.slug}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
