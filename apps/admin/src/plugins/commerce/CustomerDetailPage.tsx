import { useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCommerceCustomer, useUpdateCommerceCustomerDisabled } from './queries';

function DisableCustomerControl({ customerId, disabled }: { customerId: string; disabled: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const updateDisabled = useUpdateCommerceCustomerDisabled(customerId);

  async function performToggle(next: boolean) {
    try {
      await updateDisabled.mutateAsync(next);
      toast.success(next ? 'Customer disabled' : 'Customer enabled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update customer');
    }
  }

  if (disabled) {
    return (
      <Button type="button" variant="outline" onClick={() => void performToggle(false)} disabled={updateDisabled.isPending}>
        Enable customer
      </Button>
    );
  }

  return (
    <>
      <Button type="button" variant="destructive" className="w-full" onClick={() => setConfirmOpen(true)} disabled={updateDisabled.isPending}>
        Disable customer
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable this customer?</AlertDialogTitle>
            <AlertDialogDescription>
              They immediately lose access and every current session is signed out. You can re-enable them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                void performToggle(true);
              }}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const { data: customer, isPending, error } = useCommerceCustomer(customerId ?? '');

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Commerce', to: '/plugins/commerce/products' },
          { label: 'Customers', to: '/plugins/commerce/customers' },
          { label: customer?.name ?? '…' },
        ]}
      />

      <PageHeader title={customer?.name ?? 'Customer'} description={customer?.email} />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}

      {customer ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>Addresses</CardTitle>
            </CardHeader>
            <CardContent>
              {customer.addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No addresses on file.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {customer.addresses.map((address) => (
                    <div key={address.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{address.recipientName}</p>
                        {address.isDefault ? (
                          <Badge variant="outline" className="text-xs">
                            Default
                          </Badge>
                        ) : null}
                        {address.label ? <span className="text-xs text-muted-foreground">({address.label})</span> : null}
                      </div>
                      <p className="text-muted-foreground">
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ''}, {address.city}
                        {address.region ? `, ${address.region}` : ''} {address.postalCode}, {address.country}
                      </p>
                      {address.phone ? <p className="text-muted-foreground">{address.phone}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Status</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Account</span>
                  {customer.disabled ? (
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                      Disabled
                    </Badge>
                  ) : (
                    <StatusBadge status={customer.emailVerified ? 'active' : 'never-active'} />
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Email verified</span>
                  <span className="text-sm">{customer.emailVerified ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Phone</span>
                  <span className="text-sm">{customer.phone ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Joined</span>
                  <span className="text-sm">{new Date(customer.createdAt).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-sm">Danger zone</CardTitle>
              </CardHeader>
              <CardContent>
                <DisableCustomerControl customerId={customer.id} disabled={customer.disabled} />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
