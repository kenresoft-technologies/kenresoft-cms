import { useState, type FormEvent } from 'react';
import { Blocks } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import {
  useCreateReusableBlock,
  useDeleteReusableBlockById,
  useReusableBlocks,
  useUpdateReusableBlock,
} from '@/lib/queries/reusable-blocks';
import { REUSABLE_BLOCK_TYPES } from '@/lib/types';
import type { BlockType, ReusableBlock } from '@/lib/types';
import { BlockConfigForm } from '@/pages/blocks/BlockTreeEditor';
import { getBlockTypeDef } from '@/pages/blocks/block-registry';
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

function ReusableBlockDialog({
  block,
  trigger,
}: {
  block?: ReusableBlock;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(block?.name ?? '');
  const [type, setType] = useState<BlockType>(block?.type ?? REUSABLE_BLOCK_TYPES[0]);
  const [config, setConfig] = useState<Record<string, unknown>>(block?.config ?? {});
  const [error, setError] = useState<string | null>(null);
  const createBlock = useCreateReusableBlock();
  const updateBlock = useUpdateReusableBlock(block?.id ?? '');
  const isEditing = Boolean(block);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      if (isEditing) {
        await updateBlock.mutateAsync({ name, type, config });
        toast.success('Reusable block saved');
      } else {
        await createBlock.mutateAsync({ name, type, config });
        toast.success('Reusable block created');
        setName('');
        setConfig({});
      }
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save reusable block';
      setError(message);
      toast.error(message);
    }
  }

  const fields = getBlockTypeDef(type)?.fields ?? [];
  const isPending = createBlock.isPending || updateBlock.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit reusable block' : 'New reusable block'}</DialogTitle>
          <DialogDescription>
            A live reference — editing this updates every page that embeds it immediately.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reusable-block-name">Name</Label>
            <Input
              id="reusable-block-name"
              required
              placeholder="Global CTA"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reusable-block-type">Block type</Label>
            <Select
              value={type}
              onValueChange={(value) => {
                setType(value as BlockType);
                setConfig({});
              }}
              disabled={isEditing}
            >
              <SelectTrigger id="reusable-block-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REUSABLE_BLOCK_TYPES.map((blockType) => (
                  <SelectItem key={blockType} value={blockType}>
                    {getBlockTypeDef(blockType)?.label ?? blockType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <BlockConfigForm fields={fields} config={config} onChange={setConfig} />
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

function DeleteReusableBlockButton({ id, name }: { id: string; name: string }) {
  const deleteBlock = useDeleteReusableBlockById();

  async function handleDelete() {
    try {
      await deleteBlock.mutateAsync(id);
      toast.success('Reusable block deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete reusable block');
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
            Any page referencing this block will show nothing in its place. This can't be undone.
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

const columns: ColumnDef<ReusableBlock>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: 'type',
    header: 'Type',
    cell: ({ row }) => <Badge variant="outline">{getBlockTypeDef(row.original.type)?.label ?? row.original.type}</Badge>,
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
        <ReusableBlockDialog
          block={row.original}
          trigger={
            <Button type="button" variant="ghost" size="sm">
              Edit
            </Button>
          }
        />
        <DeleteReusableBlockButton id={row.original.id} name={row.original.name} />
      </div>
    ),
  },
];

// Phase 4 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.4) — reusable blocks are
// live references, not templates, so this page is purely CRUD (no revision history, unlike
// Pages/Templates further down the composition chain).
export function ReusableBlocksPage() {
  const { data: blocks, isPending, error, refetch } = useReusableBlocks();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Reusable blocks' }]} />

      <PageHeader
        title="Reusable blocks"
        description="A block managed in one place and referenced from any number of pages."
        actions={<ReusableBlockDialog trigger={<Button>New reusable block</Button>} />}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={4} />
          </Table>
        </div>
      ) : null}

      {blocks && blocks.length === 0 ? (
        <EmptyState
          icon={Blocks}
          title="No reusable blocks yet"
          description="Create one to reference it from any number of pages."
        />
      ) : null}

      {blocks && blocks.length > 0 ? (
        <DataTable columns={columns} data={blocks} searchPlaceholder="Search reusable blocks…" onRefresh={() => void refetch()} />
      ) : null}
    </div>
  );
}
