import { useMemo, useState, type FormEvent } from 'react';
import { Check, Copy, Plus, Trash2, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useCreateUser, useDeleteUser, useUpdateUserRole, useUsers } from '@/lib/queries/users';
import type { AdminUser, UserRole } from '@/lib/types';
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

function RoleCell({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const updateRole = useUpdateUserRole();

  if (!canEdit) {
    return (
      <Badge variant="secondary" className="capitalize">
        {user.role}
      </Badge>
    );
  }

  return (
    <Select
      value={user.role}
      disabled={updateRole.isPending}
      onValueChange={(value) => {
        updateRole.mutate(
          { id: user.id, role: value as UserRole },
          {
            onError: (err) => {
              toast.error(err instanceof ApiError ? err.message : 'Failed to update role');
            },
          },
        );
      }}
    >
      <SelectTrigger size="sm" className="w-28 capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="owner">Owner</SelectItem>
        <SelectItem value="editor">Editor</SelectItem>
      </SelectContent>
    </Select>
  );
}

// Shown once, right after creation — there's no email sending configured (§9), so this is the
// only place the temporary password is ever visible. Copy-to-clipboard because reading a
// 24-character random string aloud or retyping it is exactly the kind of thing that goes wrong.
function TemporaryPasswordDialog({
  created,
  onClose,
}: {
  created: { user: AdminUser; temporaryPassword: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select and copy the password manually');
    }
  }

  return (
    <Dialog open={created !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created?.user.name} was added</DialogTitle>
          <DialogDescription>
            Share this temporary password with them directly — it won't be shown again. They can change
            it from their Profile page after signing in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="temp-password">Temporary password</Label>
          <div className="flex gap-2">
            <Input id="temp-password" readOnly value={created?.temporaryPassword ?? ''} className="font-mono" />
            <Button type="button" variant="outline" size="icon" onClick={() => void handleCopy()} aria-label="Copy password">
              {copied ? <Check className="text-success" /> : <Copy />}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddUserDialog({ onCreated }: { onCreated: (result: { user: AdminUser; temporaryPassword: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createUser = useCreateUser();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const result = await createUser.mutateAsync({ name, email });
      toast.success('User created');
      setName('');
      setEmail('');
      setOpen(false);
      onCreated(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create user';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Creates the account directly with a random temporary password, shown once after you submit —
            there's no email invite (no email sending is configured yet). New users default to editor.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-user-name">Name</Label>
            <Input id="new-user-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createUser.isPending}>
              {createUser.isPending ? 'Creating…' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const { data: session } = authClient.useSession();
  const isOwner = session?.user.role === 'owner';
  const { data: users, isPending, error, refetch } = useUsers();
  const deleteUser = useDeleteUser();
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
  const [created, setCreated] = useState<{ user: AdminUser; temporaryPassword: string } | null>(null);

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteUser.mutateAsync(pendingDelete.id);
      toast.success('User removed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove user');
    } finally {
      setPendingDelete(null);
    }
  }

  const columns = useMemo<ColumnDef<AdminUser>[]>(
    () => [
      { accessorKey: 'name', header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { accessorKey: 'email', header: 'Email', cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span> },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ row }) => <RoleCell user={row.original} canEdit={isOwner} />,
      },
      {
        accessorKey: 'lastActiveAt',
        header: 'Last active',
        sortingFn: (rowA, rowB) =>
          new Date(rowA.original.lastActiveAt ?? 0).getTime() - new Date(rowB.original.lastActiveAt ?? 0).getTime(),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.lastActiveAt ? new Date(row.original.lastActiveAt).toLocaleString() : 'Never'}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Joined',
        sortingFn: (rowA, rowB) => new Date(rowA.original.createdAt).getTime() - new Date(rowB.original.createdAt).getTime(),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{new Date(row.original.createdAt).toLocaleDateString()}</span>
        ),
      },
      ...(isOwner
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: AdminUser } }) =>
                row.original.id === session?.user.id ? null : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${row.original.name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingDelete(row.original)}
                  >
                    <Trash2 />
                  </Button>
                ),
            } satisfies ColumnDef<AdminUser>,
          ]
        : []),
    ],
    [isOwner, session?.user],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Users' }]} />

      <PageHeader
        title="Users"
        description={isOwner ? 'Everyone with access to this admin, and their role.' : 'Everyone with access to this admin.'}
        actions={isOwner ? <AddUserDialog onCreated={setCreated} /> : undefined}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead>Joined</TableHead>
                {isOwner ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={isOwner ? 6 : 5} />
          </Table>
        </div>
      ) : null}

      {users && users.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users yet" description="Users appear here once they sign up." />
      ) : null}

      {users && users.length > 0 ? (
        <DataTable
          columns={columns}
          data={users}
          searchPlaceholder="Search users…"
          onRefresh={() => void refetch()}
        />
      ) : null}

      <TemporaryPasswordDialog created={created} onClose={() => setCreated(null)} />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They immediately lose access to this admin. Entries, revisions, and media they created stay in
              place, just no longer attributed to anyone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleConfirmDelete()}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
