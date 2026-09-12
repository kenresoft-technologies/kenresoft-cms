import { useState, type FormEvent } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { useContentTypes } from '@/lib/queries/content-types';
import { useCreateTemplate, useDeleteTemplateById, useTemplates, useUpdateTemplate } from '@/lib/queries/templates';
import type { BlockInstance, Template } from '@/lib/types';
import { BlockTreeEditor } from '@/pages/blocks/BlockTreeEditor';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { TableSkeleton } from '@/components/table-skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

const GENERAL_TEMPLATE_VALUE = '__general__';

function TemplateDialog({ template, trigger }: { template?: Template; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(template?.name ?? '');
  const [contentTypeId, setContentTypeId] = useState<string>(template?.contentTypeId ?? GENERAL_TEMPLATE_VALUE);
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [blocks, setBlocks] = useState<BlockInstance[]>(template?.blocks ?? []);
  const [error, setError] = useState<string | null>(null);
  const { data: contentTypes } = useContentTypes();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate(template?.id ?? '');
  const isEditing = Boolean(template);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const input = {
      name,
      contentTypeId: contentTypeId === GENERAL_TEMPLATE_VALUE ? null : contentTypeId,
      isDefault,
      blocks,
    };

    try {
      if (isEditing) {
        await updateTemplate.mutateAsync(input);
        toast.success('Template saved');
      } else {
        await createTemplate.mutateAsync(input);
        toast.success('Template created');
        setName('');
        setBlocks([]);
      }
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save template';
      setError(message);
      toast.error(message);
    }
  }

  const isPending = createTemplate.isPending || updateTemplate.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit template' : 'New template'}</DialogTitle>
          <DialogDescription>
            A default block composition, copied into a new page when it's created from this
            template — editing it later never changes pages already created.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                required
                placeholder="Landing page"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="template-content-type">Scope</Label>
              <Select value={contentTypeId} onValueChange={setContentTypeId}>
                <SelectTrigger id="template-content-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GENERAL_TEMPLATE_VALUE}>General-purpose page template</SelectItem>
                  {contentTypes?.map((contentType) => (
                    <SelectItem key={contentType.id} value={contentType.id}>
                      {contentType.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isDefault} onCheckedChange={(checked) => setIsDefault(checked === true)} />
            Default template for this scope
          </label>
          <div>
            <Label className="mb-2 block">Blocks</Label>
            <BlockTreeEditor blocks={blocks} onChange={setBlocks} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : isEditing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const deleteTemplate = useDeleteTemplateById();

  async function handleDelete() {
    try {
      await deleteTemplate.mutateAsync(id);
      toast.success('Template deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete template');
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" onClick={(event) => event.stopPropagation()}>
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Pages already created from this template are unaffected. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const columns: ColumnDef<Template>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <span className="flex items-center gap-2 font-medium">
        {row.original.name}
        {row.original.isDefault ? (
          <Badge variant="outline" className="font-normal">
            Default
          </Badge>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: 'contentTypeId',
    header: 'Scope',
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.contentTypeId ? 'Content type' : 'General'}</span>
    ),
  },
  {
    accessorKey: 'updatedAt',
    header: 'Updated',
    sortingFn: (rowA, rowB) => new Date(rowA.original.updatedAt).getTime() - new Date(rowB.original.updatedAt).getTime(),
    cell: ({ row }) => (
      <span className="text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString()}</span>
    ),
  },
  {
    id: 'actions',
    header: '',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
        <TemplateDialog
          template={row.original}
          trigger={
            <Button type="button" variant="ghost" size="sm">
              Edit
            </Button>
          }
        />
        <DeleteTemplateButton id={row.original.id} name={row.original.name} />
      </div>
    ),
  },
];

// Phase 4 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.5) — every template is
// admin-editable data from day one (no separate "theme" concept yet).
export function TemplatesPage() {
  const { data: templates, isPending, error, refetch } = useTemplates();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Templates' }]} />

      <PageHeader
        title="Templates"
        description="A default block composition, copied into a new page when it's created from it."
        actions={<TemplateDialog trigger={<Button>New template</Button>} />}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={4} />
          </Table>
        </div>
      ) : null}

      {templates && templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No templates yet"
          description="Create one to give new pages a starting point."
        />
      ) : null}

      {templates && templates.length > 0 ? (
        <DataTable columns={columns} data={templates} searchPlaceholder="Search templates…" onRefresh={() => void refetch()} />
      ) : null}
    </div>
  );
}
