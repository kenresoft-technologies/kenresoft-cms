import { useState, type FormEvent } from 'react';
import { Package } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { roleAtLeast, type UserRole } from '@/lib/types';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
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
import { formatMoney } from './format';
import {
  useCommerceCategories,
  useCommerceProducts,
  useCreateCommerceProduct,
  type CommerceProduct,
  type CommerceProductStatus,
} from './queries';

const ALL_STATUSES = '__all__';
const ALL_CATEGORIES = '__all__';

function NewProductDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [currency, setCurrency] = useState('NGN');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const createProduct = useCreateCommerceProduct();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const priceMinorUnits = Math.round(Number(basePrice) * 100);
    if (!Number.isFinite(priceMinorUnits) || priceMinorUnits < 0) {
      setError('Enter a valid, non-negative price');
      return;
    }

    try {
      const product = await createProduct.mutateAsync({
        name,
        slug,
        basePrice: priceMinorUnits,
        currency: currency.toUpperCase(),
      });
      toast.success('Product created');
      setOpen(false);
      void navigate(`/plugins/commerce/products/${product.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create product';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setName('');
          setSlug('');
          setBasePrice('');
          setCurrency('NGN');
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>New product</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
          <DialogDescription>Variants, images, and category can be added after creation.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-name">Name</Label>
            <Input id="product-name" required value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="product-slug">Slug</Label>
            <Input id="product-slug" required value={slug} onChange={(event) => setSlug(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="product-price">Base price</Label>
              <Input
                id="product-price"
                type="number"
                min="0"
                step="0.01"
                required
                value={basePrice}
                onChange={(event) => setBasePrice(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="product-currency">Currency</Label>
              <Input
                id="product-currency"
                required
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createProduct.isPending}>
              {createProduct.isPending ? 'Creating…' : 'Create product'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProductsPage() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const canCreate = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'editor');
  const [statusFilter, setStatusFilter] = useState<typeof ALL_STATUSES | CommerceProductStatus>(ALL_STATUSES);
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);

  const { data: categories } = useCommerceCategories();
  const {
    data: products,
    isPending,
    error,
    refetch,
  } = useCommerceProducts({
    status: statusFilter === ALL_STATUSES ? undefined : statusFilter,
    categoryId: categoryFilter === ALL_CATEGORIES ? undefined : categoryFilter,
  });

  const columns: ColumnDef<CommerceProduct>[] = [
    { accessorKey: 'name', header: 'Name' },
    {
      accessorKey: 'slug',
      header: 'Slug',
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono font-normal text-muted-foreground">
          {row.original.slug}
        </Badge>
      ),
    },
    {
      id: 'price',
      header: 'Price',
      cell: ({ row }) => formatMoney(row.original.basePrice, row.original.currency),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'category',
      header: 'Category',
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {categories?.find((category) => category.id === row.original.categoryId)?.name ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
      sortingFn: (rowA, rowB) =>
        new Date(rowA.original.updatedAt).getTime() - new Date(rowB.original.updatedAt).getTime(),
      cell: ({ row }) => (
        <span className="text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString()}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Commerce', to: '/plugins/commerce/products' }, { label: 'Products' }]} />

      <PageHeader
        title="Products"
        description="Your storefront's catalog."
        actions={canCreate ? <NewProductDialog /> : undefined}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? <p className="text-muted-foreground">Loading…</p> : null}

      {products && products.length === 0 && statusFilter === ALL_STATUSES && categoryFilter === ALL_CATEGORIES ? (
        <EmptyState
          icon={Package}
          title="No products yet"
          description={canCreate ? 'Create one to start building your catalog.' : 'Ask an editor to add a product.'}
        />
      ) : null}

      {products && !(products.length === 0 && statusFilter === ALL_STATUSES && categoryFilter === ALL_CATEGORIES) ? (
        <DataTable
          columns={columns}
          data={products}
          searchPlaceholder="Search products…"
          onRowClick={(row) => navigate(`/plugins/commerce/products/${row.id}`)}
          onRefresh={() => void refetch()}
          toolbar={
            <>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
                  {categories?.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
        />
      ) : null}
    </div>
  );
}
