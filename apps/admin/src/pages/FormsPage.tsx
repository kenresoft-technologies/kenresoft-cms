import { useState, type FormEvent } from 'react';
import { BookOpen, ChevronRight, ClipboardList, LayoutTemplate } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { API_URL, apiClient, ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useCreateForm, useForms } from '@/lib/queries/forms';
import { useFormFields } from '@/lib/queries/form-fields';
import type { Form, FormField, FormFieldType } from '@/lib/types';
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

function FieldsCountCell({ formId }: { formId: string }) {
  const { data: fields, isPending } = useFormFields(formId);
  if (isPending) return <span className="text-muted-foreground">…</span>;
  const count = fields?.length ?? 0;
  return (
    <span className="text-muted-foreground">
      {count} {count === 1 ? 'field' : 'fields'}
    </span>
  );
}

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
    id: 'fields',
    header: 'Fields',
    enableSorting: false,
    cell: ({ row }) => <FieldsCountCell formId={row.original.id} />,
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

function QuickReferenceDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <BookOpen />
          Quick reference
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>How forms work</DialogTitle>
          <DialogDescription>What actually happens between a visitor's submit and this inbox (§7).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          <div>
            <p className="font-medium">Submission endpoint</p>
            <code className="mt-1 block rounded bg-muted px-2 py-1.5 text-xs break-all">
              POST {API_URL}/api/v1/public/forms/&lt;slug&gt;/submissions
            </code>
            <p className="mt-1 text-muted-foreground">Unauthenticated — any frontend can POST a JSON body here directly.</p>
          </div>
          <div>
            <p className="font-medium">Validation</p>
            <p className="text-muted-foreground">
              The body is checked against this form's own field definitions: required fields
              must be present, and any field not defined on the form is dropped rather than
              stored.
            </p>
          </div>
          <div>
            <p className="font-medium">Sanitization</p>
            <p className="text-muted-foreground">
              Every angle bracket (&lt; and &gt;) is stripped from string values before storage —
              a submission can't inject HTML or script tags into what you see in the inbox.
            </p>
          </div>
          <div>
            <p className="font-medium">Rate limiting</p>
            <p className="text-muted-foreground">5 submissions per 60 seconds, per client IP, enforced at the edge.</p>
          </div>
          <div>
            <p className="font-medium">Field types</p>
            <p className="text-muted-foreground">text, textarea, email, url, number, date, select, checkbox.</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FormTemplate {
  name: string;
  slug: string;
  description: string;
  fields: { name: string; label: string; fieldType: FormFieldType; required: boolean }[];
}

const FORM_TEMPLATES: FormTemplate[] = [
  {
    name: 'Contact',
    slug: 'contact',
    description: 'Name, email, and a message — the standard "get in touch" form.',
    fields: [
      { name: 'name', label: 'Name', fieldType: 'text', required: true },
      { name: 'email', label: 'Email', fieldType: 'email', required: true },
      { name: 'message', label: 'Message', fieldType: 'textarea', required: true },
    ],
  },
  {
    name: 'Newsletter signup',
    slug: 'newsletter',
    description: 'Just an email address — for a footer or landing-page opt-in.',
    fields: [{ name: 'email', label: 'Email', fieldType: 'email', required: true }],
  },
];

function ExamplesDialog() {
  const [open, setOpen] = useState(false);
  const [creatingSlug, setCreatingSlug] = useState<string | null>(null);
  const navigate = useNavigate();
  const createForm = useCreateForm();

  async function handleUseTemplate(template: FormTemplate) {
    setCreatingSlug(template.slug);
    try {
      const form = await createForm.mutateAsync({ name: template.name, slug: template.slug });
      for (const field of template.fields) {
        // Sequential, not Promise.all — sortOrder is assigned server-side from "how many
        // fields exist already" (apps/api/src/routes/admin/forms.ts), so concurrent creates
        // would race and could all land on the same position. Calling apiClient directly
        // (not useCreateFormField) because that hook is bound to one formId at render time —
        // this loop creates fields for a form that doesn't exist yet when the component mounts.
        await apiClient.post<FormField>(`/api/v1/admin/forms/${form.id}/fields`, field);
      }
      toast.success(`${template.name} form created`);
      setOpen(false);
      void navigate(`/forms/${form.id}`);
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
          <DialogDescription>Creates a real form with these fields already added — edit or delete anything after.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {FORM_TEMPLATES.map((template) => (
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
  const isAdmin = session?.user.role === 'admin';
  const { data: forms, isPending, error, refetch } = useForms();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Forms' }]} />

      <PageHeader
        title="Forms"
        description="Forms visitors can submit, like Contact or Newsletter signup."
        actions={
          <>
            <QuickReferenceDialog />
            {isAdmin ? <ExamplesDialog /> : null}
            {isAdmin ? <NewFormDialog /> : null}
          </>
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

      {forms && forms.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No forms yet"
          description={isAdmin ? 'Create one to start collecting submissions.' : 'Ask an admin to create a form to get started.'}
        />
      ) : null}

      {forms && forms.length > 0 ? (
        <DataTable
          columns={columns}
          data={forms}
          searchPlaceholder="Search forms…"
          onRowClick={(row) => navigate(`/forms/${row.id}`)}
          onRefresh={() => void refetch()}
        />
      ) : null}
    </div>
  );
}
