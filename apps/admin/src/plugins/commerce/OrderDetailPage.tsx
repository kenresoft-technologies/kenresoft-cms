import { useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatMoney } from './format';
import { useCommerceOrder, useUpdateCommerceOrderStatus, type CommerceOrderStatus } from './queries';

// 'refunded' is deliberately omitted — the API has no transition reaching it today (no
// provider-backed Paystack refund is actually issued), so offering it here would just be a
// control that always 400s. See repository/orders.ts's own comment for the full reasoning.
const STATUS_OPTIONS: CommerceOrderStatus[] = ['pending', 'paid', 'fulfilled', 'cancelled'];

function OrderStatusControl({ orderId, status }: { orderId: string; status: CommerceOrderStatus }) {
  const updateStatus = useUpdateCommerceOrderStatus(orderId);

  async function handleChange(next: string) {
    try {
      await updateStatus.mutateAsync(next as CommerceOrderStatus);
      toast.success(`Order marked ${next}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update order status');
    }
  }

  return (
    <Select value={status} onValueChange={(value) => void handleChange(value)} disabled={updateStatus.isPending}>
      <SelectTrigger size="sm" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((option) => (
          <SelectItem key={option} value={option}>
            {option[0]!.toUpperCase() + option.slice(1)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { data: order, isPending, error } = useCommerceOrder(orderId ?? '');

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Commerce', to: '/plugins/commerce/products' },
          { label: 'Orders', to: '/plugins/commerce/orders' },
          { label: order ? `#${order.id.slice(0, 8)}` : '…' },
        ]}
      />

      <PageHeader
        title={order ? `Order #${order.id.slice(0, 8)}` : 'Order'}
        description={order?.customerEmail}
        actions={order ? <OrderStatusControl orderId={order.id} status={order.status} /> : undefined}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}

      {order ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.productName}
                        {item.variantName ? <span className="text-muted-foreground"> — {item.variantName}</span> : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.sku ?? '—'}</TableCell>
                      <TableCell className="text-right">{formatMoney(item.unitPriceAtPurchase, order.currency)}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatMoney(item.unitPriceAtPurchase * item.quantity, order.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 flex justify-end border-t pt-4">
                <span className="font-medium">Total: {formatMoney(order.totalAmount, order.currency)}</span>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Status</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Order status</span>
                  <StatusBadge status={order.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Placed</span>
                  <span className="text-sm">{new Date(order.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Customer</span>
                  <span className="text-sm">{order.customerId ? order.customerName : `${order.customerName} (guest)`}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Shipping address</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{order.shippingAddress.recipientName}</p>
                <p>
                  {order.shippingAddress.line1}
                  {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}, {order.shippingAddress.city}
                  {order.shippingAddress.region ? `, ${order.shippingAddress.region}` : ''} {order.shippingAddress.postalCode},{' '}
                  {order.shippingAddress.country}
                </p>
                {order.shippingAddress.phone ? <p>{order.shippingAddress.phone}</p> : null}
              </CardContent>
            </Card>

            {order.payments.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Payment attempts</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {order.payments.map((payment) => (
                    <div key={payment.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-muted-foreground">{payment.reference.slice(0, 12)}…</span>
                        <StatusBadge status={payment.status === 'success' ? 'paid' : payment.status === 'failed' ? 'cancelled' : 'pending'} />
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {payment.amount !== null && payment.currency ? formatMoney(payment.amount, payment.currency) : '—'} via {payment.provider}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Initialized {new Date(payment.createdAt).toLocaleString()}
                        {payment.resolvedAt ? ` · resolved ${new Date(payment.resolvedAt).toLocaleString()}` : ''}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
