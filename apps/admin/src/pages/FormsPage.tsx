import { useState, type FormEvent } from 'react';
import { ChevronRight, ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useCreateForm, useForms } from '@/lib/queries/forms';
import type { Form } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
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

const columns: ColumnDef<Form>[] = [
  { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
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
    id: 'chevron',
    header: '',
    enableSorting: false,
    cell: () => (
      <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    ),
  },
];

function NewFormDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createForm = useCreateForm();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await createForm.mutateAsync({ name, slug });
      toast.success('Form created');
      setName('');
      setSlug('');
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create form';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New form</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New form</DialogTitle>
          <DialogDescription>
            A form visitors can submit, such as Contact or Newsletter signup (§7).
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="form-name">Name</Label>
            <Input id="form-name" required value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="form-slug">Slug</Label>
            <Input
              id="form-slug"
              required
              placeholder="contact"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createForm.isPending}>
              {createForm.isPending ? 'Creating…' : 'Create form'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FormsPage() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const isOwner = session?.user.role === 'owner';
  const { data: forms, isPending, error } = useForms();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Forms' }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Forms</h1>
          <p className="text-muted-foreground">Forms visitors can submit, like Contact or Newsletter signup.</p>
        </div>
        {isOwner ? <NewFormDialog /> : null}
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

      {forms && forms.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No forms yet"
          description={isOwner ? 'Create one to start collecting submissions.' : 'Ask an owner to create a form to get started.'}
        />
      ) : null}

      {forms && forms.length > 0 ? (
        <DataTable
          columns={columns}
          data={forms}
          searchPlaceholder="Search forms…"
          onRowClick={(row) => navigate(`/forms/${row.id}`)}
        />
      ) : null}
    </div>
  );
}
