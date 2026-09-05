import { useState, type FormEvent } from 'react';
import { FolderTree } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { roleAtLeast, type UserRole } from '@/lib/types';
import { EmptyState } from '@/components/empty-state';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  useCommerceCategories,
  useCreateCommerceCategory,
  useDeleteCommerceCategory,
  useUpdateCommerceCategory,
  type CommerceCategory,
  type CommerceCategoryStatus,
} from './queries';

const NO_PARENT = '__none__';

interface CategoryFormState {
  name: string;
  slug: string;
  description: string;
  parentId: string;
  status: CommerceCategoryStatus;
}

function emptyForm(): CategoryFormState {
  return { name: '', slug: '', description: '', parentId: NO_PARENT, status: 'active' };
}

function formFromCategory(category: CommerceCategory): CategoryFormState {
  return {
    name: category.name,
    slug: category.slug,
    description: category.description ?? '',
    parentId: category.parentId ?? NO_PARENT,
    status: category.status,
  };
}

function CategoryFormFields({
  form,
  onChange,
  categories,
  excludeId,
}: {
  form: CategoryFormState;
  onChange: (form: CategoryFormState) => void;
  categories: CommerceCategory[];
  excludeId?: string;
}) {
  const parentOptions = categories.filter((category) => category.id !== excludeId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="category-name">Name</Label>
        <Input
          id="category-name"
          required
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="category-slug">Slug</Label>
        <Input
          id="category-slug"
          required
          value={form.slug}
          onChange={(event) => onChange({ ...form, slug: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="category-description">Description (optional)</Label>
        <Textarea
          id="category-description"
          rows={2}
          value={form.description}
          onChange={(event) => onChange({ ...form, description: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="category-parent">Parent category</Label>
        <Select value={form.parentId} onValueChange={(value) => onChange({ ...form, parentId: value })}>
          <SelectTrigger id="category-parent" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PARENT}>None (top-level)</SelectItem>
            {parentOptions.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="category-status">Status</Label>
        <Select
          value={form.status}
          onValueChange={(value) => onChange({ ...form, status: value as CommerceCategoryStatus })}
        >
          <SelectTrigger id="category-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function NewCategoryDialog({ categories }: { categories: CommerceCategory[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CategoryFormState>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const createCategory = useCreateCommerceCategory();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await createCategory.mutateAsync({
        name: form.name,
        slug: form.slug,
        description: form.description || null,
        parentId: form.parentId === NO_PARENT ? null : form.parentId,
        status: form.status,
      });
      toast.success('Category created');
      setForm(emptyForm());
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create category';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setForm(emptyForm());
      }}
    >
      <DialogTrigger asChild>
        <Button>New category</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New category</DialogTitle>
          <DialogDescription>Groups products in the storefront, optionally under a parent.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <CategoryFormFields form={form} onChange={setForm} categories={categories} />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createCategory.isPending}>
              {createCategory.isPending ? 'Creating…' : 'Create category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditCategoryDialog({
  category,
  categories,
  open,
  onOpenChange,
}: {
  category: CommerceCategory;
  categories: CommerceCategory[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState<CategoryFormState>(() => formFromCategory(category));
  const [error, setError] = useState<string | null>(null);
  const updateCategory = useUpdateCommerceCategory(category.id);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await updateCategory.mutateAsync({
        name: form.name,
        slug: form.slug,
        description: form.description || null,
        parentId: form.parentId === NO_PARENT ? null : form.parentId,
        status: form.status,
      });
      toast.success('Category saved');
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save category';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit category</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <CategoryFormFields form={form} onChange={setForm} categories={categories} excludeId={category.id} />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={updateCategory.isPending}>
              {updateCategory.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCategoryAlert({ category }: { category: CommerceCategory }) {
  const deleteCategory = useDeleteCommerceCategory();

  async function handleDelete() {
    try {
      await deleteCategory.mutateAsync(category.id);
      toast.success('Category deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete category');
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
          <AlertDialogTitle>Delete "{category.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Products in this category are not deleted, but lose their category assignment. Any
            child categories become top-level. This cannot be undone.
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

function CategoryRow({
  category,
  categories,
  parentName,
  canEdit,
}: {
  category: CommerceCategory;
  categories: CommerceCategory[];
  parentName: string | undefined;
  canEdit: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <TableRow>
      <TableCell className="font-medium">{category.name}</TableCell>
      <TableCell>
        <Badge variant="outline" className="font-mono font-normal text-muted-foreground">
          {category.slug}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{parentName ?? '—'}</TableCell>
      <TableCell>
        <StatusBadge status={category.status} />
      </TableCell>
      {canEdit ? (
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <DeleteCategoryAlert category={category} />
          </div>
          <EditCategoryDialog category={category} categories={categories} open={editOpen} onOpenChange={setEditOpen} />
        </TableCell>
      ) : null}
    </TableRow>
  );
}

export function CategoriesPage() {
  const { data: session } = authClient.useSession();
  const canEdit = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'editor');
  const { data: categories, isPending, error } = useCommerceCategories();

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'Commerce', to: '/plugins/commerce/products' }, { label: 'Categories' }]} />

      <PageHeader
        title="Categories"
        description="Groups for organizing products in the storefront."
        actions={canEdit ? <NewCategoryDialog categories={categories ?? []} /> : undefined}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? <p className="text-muted-foreground">Loading…</p> : null}

      {categories && categories.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No categories yet"
          description={canEdit ? 'Create one to start organizing products.' : 'Ask an editor to create a category.'}
        />
      ) : null}

      {categories && categories.length > 0 ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Status</TableHead>
                {canEdit ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  categories={categories}
                  parentName={categories.find((candidate) => candidate.id === category.parentId)?.name}
                  canEdit={canEdit}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
