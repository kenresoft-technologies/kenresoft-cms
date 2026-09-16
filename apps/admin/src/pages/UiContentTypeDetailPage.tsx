import { useState } from 'react';
import { FileStack, Plus, Trash2 } from 'lucide-react';
import { useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import {
  useCreateUiContentItem,
  useDeleteUiContentItem,
  useUiContentItems,
  useUiContentType,
  useUpdateUiContentItem,
} from '@/lib/queries/ui-content';
import { roleAtLeast } from '@/lib/types';
import type { FieldDefinition, UiContentFieldDefinition, UiContentItem, UserRole } from '@/lib/types';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { FieldInput } from '@/components/field-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// FieldInput (apps/admin/src/components/field-input.tsx) only ever reads name/label/fieldType/
// required/config off the field it's given — confirmed by inspection — so a UI content field
// definition (which lacks id/contentTypeId/sortOrder/presentation/timestamps) can drive it
// directly via this adapter, reusing the exact same per-field-type rendering entries/content
// types already use rather than duplicating it.
function toFieldDefinitionAdapter(field: UiContentFieldDefinition): FieldDefinition {
  return {
    id: field.name,
    contentTypeId: '',
    name: field.name,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    sortOrder: 0,
    config: field.config,
    presentation: null,
    createdAt: '',
    updatedAt: '',
  };
}

function ItemFormDialog({
  typeId,
  fields,
  item,
  open,
  onOpenChange,
}: {
  typeId: string;
  fields: UiContentFieldDefinition[];
  item?: UiContentItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEditing = item !== undefined;
  const [slug, setSlug] = useState(item?.slug ?? '');
  const [data, setData] = useState<Record<string, unknown>>(item?.data ?? {});
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const createItem = useCreateUiContentItem(typeId);
  const updateItem = useUpdateUiContentItem(typeId);

  async function handleSubmit() {
    setError(null);
    if (!slug.trim()) {
      setError('Enter a slug');
      return;
    }
    try {
      if (isEditing) {
        await updateItem.mutateAsync({ id: item.id, slug, data, enabled });
        toast.success('Item updated');
      } else {
        await createItem.mutateAsync({ slug, data, enabled });
        toast.success('Item created');
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save item');
    }
  }

  const isPending = createItem.isPending || updateItem.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit item' : 'New item'}</DialogTitle>
          <DialogDescription>Addressed publicly by (type slug, item slug).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ui-item-slug">Slug</Label>
            <Input id="ui-item-slug" placeholder="home-page-hero" value={slug} onChange={(event) => setSlug(event.target.value)} />
          </div>

          {fields.map((field) => (
            <div key={field.name} className="flex flex-col gap-2">
              <Label>
                {field.label}
                {field.required ? ' *' : ''}
              </Label>
              <FieldInput
                field={toFieldDefinitionAdapter(field)}
                value={data[field.name]}
                onChange={(value) => setData((prev) => ({ ...prev, [field.name]: value }))}
              />
            </div>
          ))}

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            Enabled (visible on the public API)
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={() => void handleSubmit()} disabled={isPending}>
            {isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UiContentTypeDetailPage() {
  const { typeId } = useParams<{ typeId: string }>();
  const { data: session } = authClient.useSession();
  const canManage = roleAtLeast((session?.user.role as UserRole | undefined) ?? 'viewer', 'editor');

  const { data: type, isPending: typePending } = useUiContentType(typeId);
  const { data: items, isPending: itemsPending } = useUiContentItems(typeId);
  const deleteItem = useDeleteUiContentItem(typeId ?? '');

  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<UiContentItem | null>(null);

  async function handleDelete(item: UiContentItem) {
    try {
      await deleteItem.mutateAsync(item.id);
      toast.success('Item deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete item');
    }
  }

  if (typePending || !typeId) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (!type) {
    return <p className="text-destructive">UI content type not found.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'UI content', to: '/ui-content' }, { label: type.name }]} />
      <PageHeader
        title={type.name}
        description={`${type.fields.length} field${type.fields.length === 1 ? '' : 's'} · slug "${type.slug}"`}
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              New item
            </Button>
          ) : undefined
        }
      />

      {!itemsPending && items && items.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title="No items yet"
          description="Create an item to publish structured data through the public API."
        />
      ) : null}

      {items && items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-sm">{item.slug}</TableCell>
                <TableCell>{item.enabled ? 'Yes' : 'No'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(item.updatedAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  {canManage ? (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditingItem(item)}>
                        Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label={`Delete ${item.slug}`}>
                            <Trash2 />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete "{item.slug}"?</AlertDialogTitle>
                            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void handleDelete(item)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {canManage ? (
        <>
          <ItemFormDialog typeId={type.id} fields={type.fields} open={createOpen} onOpenChange={setCreateOpen} />
          {editingItem ? (
            <ItemFormDialog
              typeId={type.id}
              fields={type.fields}
              item={editingItem}
              open={editingItem !== null}
              onOpenChange={(open) => !open && setEditingItem(null)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
