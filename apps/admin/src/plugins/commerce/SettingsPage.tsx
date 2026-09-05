import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { roleAtLeast, type UserRole } from '@/lib/types';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useCommerceSettings, useUpdateCommerceSettings } from './queries';

function SettingsForm({ storeName: initialStoreName, defaultCurrency: initialDefaultCurrency, canEdit }: {
  storeName: string;
  defaultCurrency: string;
  canEdit: boolean;
}) {
  const [storeName, setStoreName] = useState(initialStoreName);
  const [defaultCurrency, setDefaultCurrency] = useState(initialDefaultCurrency);
  const [error, setError] = useState<string | null>(null);
  const updateSettings = useUpdateCommerceSettings();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await updateSettings.mutateAsync({ storeName, defaultCurrency: defaultCurrency.toUpperCase() });
      toast.success('Settings saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save settings';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Store</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex max-w-md flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="store-name">Store name</Label>
            <Input
              id="store-name"
              required
              disabled={!canEdit}
              value={storeName}
              onChange={(event) => setStoreName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="store-currency">Default currency</Label>
            <Input
              id="store-currency"
              required
              maxLength={3}
              disabled={!canEdit}
              value={defaultCurrency}
              onChange={(event) => setDefaultCurrency(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">A 3-letter ISO currency code, e.g. NGN or USD.</p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {canEdit ? (
            <Button type="submit" disabled={updateSettings.isPending} className="w-fit">
              {updateSettings.isPending ? 'Saving…' : 'Save'}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

export function CommerceSettingsPage() {
  const { data: session } = authClient.useSession();
  const canEdit = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'editor');
  const { data: settings, isPending, error } = useCommerceSettings();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Commerce', to: '/plugins/commerce/products' }, { label: 'Settings' }]} />

      <PageHeader title="Commerce settings" description="Store-wide settings for the commerce plugin." />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? <Skeleton className="h-48 w-full max-w-md" /> : null}

      {settings ? (
        <SettingsForm storeName={settings.storeName} defaultCurrency={settings.defaultCurrency} canEdit={canEdit} />
      ) : null}
    </div>
  );
}
