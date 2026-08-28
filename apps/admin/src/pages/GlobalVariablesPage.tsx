import { useMemo, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2, Variable } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import {
  useCreateGlobalVariable,
  useDeleteGlobalVariable,
  useGlobalVariables,
  useUpdateGlobalVariable,
} from '@/lib/queries/global-variables';
import { roleAtLeast, type GlobalVariable, type UserRole } from '@/lib/types';
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
} from '@/components/ui/alert-dialog';
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
import { Table, TableHeader, TableHead, TableRow } from '@/components/ui/table';

function NewVariableDialog() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createVariable = useCreateGlobalVariable();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await createVariable.mutateAsync({ key, value });
      toast.success('Variable created');
      setKey('');
      setValue('');
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create variable';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New variable
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New global variable</DialogTitle>
          <DialogDescription>
            A reusable value — a phone number, an address — any published entry's frontend can fetch from{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">GET /api/v1/public/global-variables</code>.
            The key can't be changed after creation.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="gv-key">Key</Label>
            <Input
              id="gv-key"
              required
              placeholder="phone_number"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="gv-value">Value</Label>
            <Input id="gv-value" required value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createVariable.isPending}>
              {createVariable.isPending ? 'Creating…' : 'Create variable'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditVariableDialog({ variable, trigger }: { variable: GlobalVariable; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {variable.key}</DialogTitle>
          <DialogDescription>The key stays fixed — only the value changes.</DialogDescription>
        </DialogHeader>
        {open ? <EditVariableForm variable={variable} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditVariableForm({ variable, onDone }: { variable: GlobalVariable; onDone: () => void }) {
  const [value, setValue] = useState(variable.value);
  const [error, setError] = useState<string | null>(null);
  const updateVariable = useUpdateGlobalVariable();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await updateVariable.mutateAsync({ id: variable.id, value });
      toast.success('Variable updated');
      onDone();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update variable';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="gv-edit-value">Value</Label>
        <Input id="gv-edit-value" required value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="submit" disabled={updateVariable.isPending}>
          {updateVariable.isPending ? 'Saving…' : 'Save value'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function GlobalVariablesPage() {
  const { data: session } = authClient.useSession();
  const isAdmin = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'admin');
  // Matches the API's own gate (apps/api/src/routes/admin/global-variables.ts) — author and
  // viewer can't edit a value, only admin/editor.
  const canEditValue = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'editor');
  const { data: variables, isPending, error, refetch } = useGlobalVariables();
  const deleteVariable = useDeleteGlobalVariable();
  const [pendingDelete, setPendingDelete] = useState<GlobalVariable | null>(null);

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteVariable.mutateAsync(pendingDelete.id);
      toast.success('Variable deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete variable');
    } finally {
      setPendingDelete(null);
    }
  }

  const columns = useMemo<ColumnDef<GlobalVariable>[]>(
    () => [
      {
        accessorKey: 'key',
        header: 'Key',
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.key}</span>,
      },
      {
        accessorKey: 'value',
        header: 'Value',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.value}</span>,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {canEditValue ? (
              <EditVariableDialog
                variable={row.original}
                trigger={
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${row.original.key}`}>
                    <Pencil />
                  </Button>
                }
              />
            ) : null}
            {isAdmin ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${row.original.key}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setPendingDelete(row.original)}
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [isAdmin, canEditValue],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Global variables' }]} />

      <PageHeader
        title="Global variables"
        description="Reusable key/value pairs, exposed read-only to the public API for frontends to consume."
        actions={isAdmin ? <NewVariableDialog /> : undefined}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={3} />
          </Table>
        </div>
      ) : null}

      {variables && variables.length === 0 ? (
        <EmptyState
          icon={Variable}
          title="No global variables yet"
          description="Add reusable values like a phone number or address for frontends to fetch."
        />
      ) : null}

      {variables && variables.length > 0 ? (
        <DataTable columns={columns} data={variables} searchPlaceholder="Search variables…" onRefresh={() => void refetch()} />
      ) : null}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pendingDelete?.key}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Any frontend fetching the public global-variables endpoint stops seeing this key
              immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleConfirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
