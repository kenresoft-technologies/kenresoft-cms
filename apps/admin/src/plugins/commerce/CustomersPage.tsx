import { Users as UsersIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCommerceCustomers, type CommerceCustomerSummary } from './queries';

const columns: ColumnDef<CommerceCustomerSummary>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email', cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span> },
  {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    cell: ({ row }) =>
      row.original.disabled ? (
        <Badge variant="outline" className="gap-1 border-destructive/30 bg-destructive/10 text-destructive">
          Disabled
        </Badge>
      ) : (
        <StatusBadge status={row.original.emailVerified ? 'active' : 'never-active'} />
      ),
  },
  {
    accessorKey: 'createdAt',
    header: 'Joined',
    sortingFn: (rowA, rowB) => new Date(rowA.original.createdAt).getTime() - new Date(rowB.original.createdAt).getTime(),
    cell: ({ row }) => <span className="text-muted-foreground">{new Date(row.original.createdAt).toLocaleDateString()}</span>,
  },
];

// Read-mostly by design this pass — the only write action is disable/enable, on the detail page.
// Customer PII is admin-role-gated server-side; a non-admin's request here just 403s, matching
// how every other admin-gated plugin route behaves (docs/PLUGINS.md's Commerce section).
export function CustomersPage() {
  const navigate = useNavigate();
  const { data: customers, isPending, error } = useCommerceCustomers();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Commerce', to: '/plugins/commerce/products' }, { label: 'Customers' }]} />

      <PageHeader title="Customers" description="Storefront customer accounts." />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={4} />
          </Table>
        </div>
      ) : null}

      {customers && customers.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No customers yet" description="Customer accounts appear here once someone registers." />
      ) : null}

      {customers && customers.length > 0 ? (
        <DataTable
          columns={columns}
          data={customers}
          searchPlaceholder="Search customers…"
          onRowClick={(row) => navigate(`/plugins/commerce/customers/${row.id}`)}
        />
      ) : null}
    </div>
  );
}
