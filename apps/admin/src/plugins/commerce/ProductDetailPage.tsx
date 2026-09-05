import { useState, type FormEvent, type ReactNode } from 'react';
import { ImageOff, Plus, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { MediaPickerDialog } from '@/components/media-picker-dialog';
import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { mediaFileUrl, useMediaList } from '@/lib/queries/media';
import { roleAtLeast, type UserRole } from '@/lib/types';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from './format';
import {
  useAddCommerceProductImage,
  useCommerceCategories,
  useCommerceProduct,
  useCreateCommerceVariant,
  useDeleteCommerceProduct,
  useDeleteCommerceVariant,
  useRemoveCommerceProductImage,
  useUpdateCommerceProduct,
  useUpdateCommerceVariant,
  type CommerceCategoryStatus,
  type CommerceProductDetail,
  type CommerceProductStatus,
  type CommerceProductType,
  type CommerceProductVariant,
} from './queries';

const NO_CATEGORY = '__none__';

function VariantFormDialog({
  productId,
  variant,
  trigger,
}: {
  productId: string;
  variant?: CommerceProductVariant;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(variant?.name ?? '');
  const [sku, setSku] = useState(variant?.sku ?? '');
  const [price, setPrice] = useState(variant?.price !== undefined && variant.price !== null ? String(variant.price / 100) : '');
  const [stockQty, setStockQty] = useState(String(variant?.stockQty ?? 0));
  const [status, setStatus] = useState<CommerceCategoryStatus>(variant?.status ?? 'active');
  const [error, setError] = useState<string | null>(null);

  const createVariant = useCreateCommerceVariant(productId);
  const updateVariant = useUpdateCommerceVariant(productId, variant?.id ?? '');
  const isPending = createVariant.isPending || updateVariant.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const priceMinorUnits = price.trim() === '' ? null : Math.round(Number(price) * 100);
    if (priceMinorUnits !== null && (!Number.isFinite(priceMinorUnits) || priceMinorUnits < 0)) {
      setError('Enter a valid, non-negative price, or leave it blank to use the base price');
      return;
    }
    const stockQtyNumber = Math.round(Number(stockQty));
    if (!Number.isFinite(stockQtyNumber) || stockQtyNumber < 0) {
      setError('Enter a valid, non-negative stock quantity');
      return;
    }

    try {
      const input = {
        name,
        sku: sku.trim() === '' ? null : sku,
        price: priceMinorUnits,
        stockQty: stockQtyNumber,
        status,
      };
      if (variant) {
        await updateVariant.mutateAsync(input);
        toast.success('Variant saved');
      } else {
        await createVariant.mutateAsync(input);
        toast.success('Variant added');
      }
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save variant';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{variant ? 'Edit variant' : 'Add variant'}</DialogTitle>
          <DialogDescription>
            Leave price blank to fall back to the product's own base price.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="variant-name">Name</Label>
            <Input id="variant-name" required value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="variant-sku">SKU (optional)</Label>
              <Input id="variant-sku" value={sku} onChange={(event) => setSku(event.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="variant-price">Price override (optional)</Label>
              <Input id="variant-price" type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="variant-stock">Stock quantity</Label>
              <Input
                id="variant-stock"
                type="number"
                min="0"
                required
                value={stockQty}
                onChange={(event) => setStockQty(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="variant-status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as CommerceCategoryStatus)}>
                <SelectTrigger id="variant-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : variant ? 'Save' : 'Add variant'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteVariantAlert({ productId, variant }: { productId: string; variant: CommerceProductVariant }) {
  const deleteVariant = useDeleteCommerceVariant(productId);

  async function handleDelete() {
    try {
      await deleteVariant.mutateAsync(variant.id);
      toast.success('Variant deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete variant');
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{variant.name}"?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
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

function VariantsCard({ product, canEdit }: { product: CommerceProductDetail; canEdit: boolean }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Variants</CardTitle>
        {canEdit ? (
          <VariantFormDialog
            productId={product.id}
            trigger={
              <Button type="button" variant="outline" size="sm">
                <Plus />
                Add variant
              </Button>
            }
          />
        ) : null}
      </CardHeader>
      <CardContent>
        {product.variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No variants yet — the base price and stock apply directly to this product.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
                {canEdit ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.variants.map((variant) => (
                <TableRow key={variant.id}>
                  <TableCell className="font-medium">{variant.name}</TableCell>
                  <TableCell className="text-muted-foreground">{variant.sku ?? '—'}</TableCell>
                  <TableCell>
                    {variant.price !== null ? formatMoney(variant.price, product.currency) : (
                      <span className="text-muted-foreground">Base price</span>
                    )}
                  </TableCell>
                  <TableCell>{variant.stockQty}</TableCell>
                  <TableCell>
                    <StatusBadge status={variant.status} />
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <VariantFormDialog
                          productId={product.id}
                          variant={variant}
                          trigger={
                            <Button variant="ghost" size="sm">
                              Edit
                            </Button>
                          }
                        />
                        <DeleteVariantAlert productId={product.id} variant={variant} />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ImagesCard({ product, canEdit }: { product: CommerceProductDetail; canEdit: boolean }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: mediaItems } = useMediaList();
  const addImage = useAddCommerceProductImage(product.id);
  const removeImage = useRemoveCommerceProductImage(product.id);

  async function handleSelect(mediaId: string) {
    try {
      await addImage.mutateAsync({ mediaId, sortOrder: product.images.length });
      toast.success('Image added');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add image');
    }
  }

  async function handleRemove(imageId: string) {
    try {
      await removeImage.mutateAsync(imageId);
      toast.success('Image removed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove image');
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Images</CardTitle>
        {canEdit ? (
          <MediaPickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelect={(mediaId) => void handleSelect(mediaId)}
            trigger={
              <Button type="button" variant="outline" size="sm">
                <Plus />
                Add image
              </Button>
            }
          />
        ) : null}
      </CardHeader>
      <CardContent>
        {product.images.length === 0 ? (
          <p className="text-sm text-muted-foreground">No images yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {product.images.map((image) => {
              const media = mediaItems?.find((item) => item.id === image.mediaId);
              return (
                <div key={image.id} className="group relative aspect-square overflow-hidden rounded-md border">
                  {media?.width && media.height ? (
                    <img
                      src={mediaFileUrl(image.mediaId)}
                      alt={image.altText ?? media.altText ?? media.filename}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center bg-muted">
                      <ImageOff className="size-5 text-muted-foreground" />
                    </div>
                  )}
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-sm"
                      aria-label="Remove image"
                      className="absolute top-1.5 right-1.5 bg-background/80 text-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive"
                      onClick={() => void handleRemove(image.id)}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeleteProductAlert({ product }: { product: CommerceProductDetail }) {
  const navigate = useNavigate();
  const deleteProduct = useDeleteCommerceProduct();

  async function handleDelete() {
    try {
      await deleteProduct.mutateAsync(product.id);
      toast.success('Product deleted');
      void navigate('/plugins/commerce/products');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete product');
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="w-full" disabled={deleteProduct.isPending}>
          Delete product
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{product.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the product, its variants, and its image associations. This
            cannot be undone.
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

function ProductForm({ product, canEdit }: { product: CommerceProductDetail; canEdit: boolean }) {
  const { data: categories } = useCommerceCategories();
  const updateProduct = useUpdateCommerceProduct(product.id);

  const [name, setName] = useState(product.name);
  const [slug, setSlug] = useState(product.slug);
  const [description, setDescription] = useState(product.description ?? '');
  const [shortDescription, setShortDescription] = useState(product.shortDescription ?? '');
  const [productType, setProductType] = useState<CommerceProductType>(product.productType);
  const [basePrice, setBasePrice] = useState(String(product.basePrice / 100));
  const [currency, setCurrency] = useState(product.currency);
  const [sku, setSku] = useState(product.sku ?? '');
  const [categoryId, setCategoryId] = useState(product.categoryId ?? NO_CATEGORY);
  const [status, setStatus] = useState<CommerceProductStatus>(product.status);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const priceMinorUnits = Math.round(Number(basePrice) * 100);
    if (!Number.isFinite(priceMinorUnits) || priceMinorUnits < 0) {
      setError('Enter a valid, non-negative price');
      return;
    }

    try {
      await updateProduct.mutateAsync({
        name,
        slug,
        description: description || null,
        shortDescription: shortDescription || null,
        productType,
        basePrice: priceMinorUnits,
        currency: currency.toUpperCase(),
        sku: sku.trim() === '' ? null : sku,
        categoryId: categoryId === NO_CATEGORY ? null : categoryId,
        status,
      });
      toast.success('Product saved');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save product';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-name">Name</Label>
                  <Input id="product-name" required disabled={!canEdit} value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-slug">Slug</Label>
                  <Input id="product-slug" required disabled={!canEdit} value={slug} onChange={(event) => setSlug(event.target.value)} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-short-description">Short description (optional)</Label>
                <Input
                  id="product-short-description"
                  disabled={!canEdit}
                  value={shortDescription}
                  onChange={(event) => setShortDescription(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-description">Description (optional)</Label>
                <Textarea
                  id="product-description"
                  rows={4}
                  disabled={!canEdit}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
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
                    disabled={!canEdit}
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
                    disabled={!canEdit}
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-sku">SKU (optional)</Label>
                  <Input id="product-sku" disabled={!canEdit} value={sku} onChange={(event) => setSku(event.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-type">Product type</Label>
                  <Select value={productType} onValueChange={(value) => setProductType(value as CommerceProductType)} disabled={!canEdit}>
                    <SelectTrigger id="product-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="physical">Physical</SelectItem>
                      <SelectItem value="digital">Digital</SelectItem>
                      <SelectItem value="service">Service</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-category">Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId} disabled={!canEdit}>
                  <SelectTrigger id="product-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>None</SelectItem>
                    {categories?.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {canEdit ? (
                <Button type="submit" disabled={updateProduct.isPending} className="w-fit">
                  {updateProduct.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <VariantsCard product={product} canEdit={canEdit} />
          <ImagesCard product={product} canEdit={canEdit} />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Current</span>
                <StatusBadge status={status} />
              </div>
              <Select value={status} onValueChange={(value) => setStatus(value as CommerceProductStatus)} disabled={!canEdit}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(product.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span>{new Date(product.updatedAt).toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>

          {canEdit ? (
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-sm">Danger zone</CardTitle>
              </CardHeader>
              <CardContent>
                <DeleteProductAlert product={product} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </form>
  );
}

export function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const { data: session } = authClient.useSession();
  const canEdit = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'editor');
  const { data: product, isPending, error } = useCommerceProduct(productId ?? '');

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Commerce', to: '/plugins/commerce/products' },
          { label: 'Products', to: '/plugins/commerce/products' },
          { label: product?.name ?? '…' },
        ]}
      />

      <PageHeader title={product?.name ?? 'Product'} description="Edit this product's details, variants, and images." />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card className="h-fit">
            <CardContent className="flex flex-col gap-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}

      {product ? <ProductForm key={product.updatedAt} product={product} canEdit={canEdit} /> : null}
    </div>
  );
}
