import { useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatMoney } from './format';
import { useCommerceOrders, type CommerceOrderStatus, type CommerceOrderSummary } from './queries';

const ALL_STATUSES = '__all__';

export function OrdersPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<typeof ALL_STATUSES | CommerceOrderStatus>(ALL_STATUSES);
  const {
    data: orders,
    isPending,
    error,
    refetch,
  } = useCommerceOrders(statusFilter === ALL_STATUSES ? undefined : statusFilter);

  const columns: ColumnDef<CommerceOrderSummary>[] = [
    {
      id: 'id',
      header: 'Order',
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono font-normal text-muted-foreground">
          {row.original.id.slice(0, 8)}
        </Badge>
      ),
    },
    { accessorKey: 'customerName', header: 'Customer' },
    {
      accessorKey: 'customerEmail',
      header: 'Email',
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.customerEmail}</span>,
    },
    {
      id: 'total',
      header: 'Total',
      cell: ({ row }) => formatMoney(row.original.totalAmount, row.original.currency),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'createdAt',
      header: 'Placed',
      sortingFn: (rowA, rowB) => new Date(rowA.original.createdAt).getTime() - new Date(rowB.original.createdAt).getTime(),
      cell: ({ row }) => <span className="text-muted-foreground">{new Date(row.original.createdAt).toLocaleString()}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Commerce', to: '/plugins/commerce/products' }, { label: 'Orders' }]} />

      <PageHeader title="Orders" description="Checkouts placed by guests and customers." />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? <p className="text-muted-foreground">Loading…</p> : null}

      {orders && orders.length === 0 && statusFilter === ALL_STATUSES ? (
        <EmptyState icon={ShoppingCart} title="No orders yet" description="Orders appear here once a customer or guest checks out." />
      ) : null}

      {orders && !(orders.length === 0 && statusFilter === ALL_STATUSES) ? (
        <DataTable
          columns={columns}
          data={orders}
          searchPlaceholder="Search orders…"
          onRowClick={(row) => navigate(`/plugins/commerce/orders/${row.id}`)}
          onRefresh={() => void refetch()}
          toolbar={
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="fulfilled">Fulfilled</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      ) : null}
    </div>
  );
}
