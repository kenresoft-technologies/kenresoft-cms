import { useMemo } from 'react';
import { Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useUpdateUserRole, useUsers } from '@/lib/queries/users';
import type { AdminUser, UserRole } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
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

export function UsersPage() {
  const { data: session } = authClient.useSession();
  const isOwner = session?.user.role === 'owner';
  const { data: users, isPending, error, refetch } = useUsers();

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
    ],
    [isOwner],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Users' }]} />

      <PageHeader
        title="Users"
        description={isOwner ? 'Everyone with access to this admin, and their role.' : 'Everyone with access to this admin.'}
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
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={5} />
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
    </div>
  );
}
