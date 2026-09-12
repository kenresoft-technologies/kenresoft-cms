import { useState, type FormEvent } from 'react';
import { FileStack } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { useCreatePage, usePages } from '@/lib/queries/pages';
import { useTemplates } from '@/lib/queries/templates';
import type { Page } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

const NO_TEMPLATE_VALUE = '__none__';

const columns: ColumnDef<Page>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
    cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
  },
  {
    accessorKey: 'route',
    header: 'Route',
    cell: ({ row }) => (
      <Badge variant="outline" className="font-mono font-normal text-muted-foreground">
        {row.original.route}
      </Badge>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: 'updatedAt',
    header: 'Updated',
    sortingFn: (rowA, rowB) => new Date(rowA.original.updatedAt).getTime() - new Date(rowB.original.updatedAt).getTime(),
    cell: ({ row }) => (
      <span className="text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString()}</span>
    ),
  },
];

function NewPageDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [route, setRoute] = useState('');
  const [templateId, setTemplateId] = useState(NO_TEMPLATE_VALUE);
  const [error, setError] = useState<string | null>(null);
  const createPage = useCreatePage();
  const { data: templates } = useTemplates();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const page = await createPage.mutateAsync({
        title,
        route,
        blocks: [],
        templateId: templateId === NO_TEMPLATE_VALUE ? undefined : templateId,
      });
      toast.success('Page created');
      setTitle('');
      setRoute('');
      setTemplateId(NO_TEMPLATE_VALUE);
      setOpen(false);
      void navigate(`/pages/${page.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create page';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New page</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New page</DialogTitle>
          <DialogDescription>A route with its own composed blocks, e.g. "/about".</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="page-title">Title</Label>
            <Input id="page-title" required value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="page-route">Route</Label>
            <Input
              id="page-route"
              required
              placeholder="/about"
              value={route}
              onChange={(event) => setRoute(event.target.value)}
            />
          </div>
          {templates && templates.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="page-template">Start from a template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger id="page-template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEMPLATE_VALUE}>Blank page</SelectItem>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createPage.isPending}>
              {createPage.isPending ? 'Creating…' : 'Create page'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Phase 3 of the schema-driven frontend work (docs/SITE_BUILDER.md) — Pages are Core, useful
// with zero plugins installed (§14 decision #1); this list mirrors FormsPage's own
// list+create-dialog shape rather than inventing a new one.
export function PagesPage() {
  const navigate = useNavigate();
  const { data: pages, isPending, error, refetch } = usePages();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Pages' }]} />

      <PageHeader
        title="Pages"
        description="Routed, block-composed pages your frontend can render directly."
        actions={<NewPageDialog />}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={4} />
          </Table>
        </div>
      ) : null}

      {pages && pages.length === 0 ? (
        <EmptyState icon={FileStack} title="No pages yet" description="Create one to compose a routed page from blocks." />
      ) : null}

      {pages && pages.length > 0 ? (
        <DataTable
          columns={columns}
          data={pages}
          searchPlaceholder="Search pages…"
          onRowClick={(row) => navigate(`/pages/${row.id}`)}
          onRefresh={() => void refetch()}
        />
      ) : null}
    </div>
  );
}
