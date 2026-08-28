import { useState, type FormEvent } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useContentType, useContentTypes, useUpdateContentType } from '@/lib/queries/content-types';
import {
  useCreateFieldDefinition,
  useDeleteFieldDefinition,
  useFieldDefinitions,
  useReorderFieldDefinitions,
  useUpdateFieldDefinition,
} from '@/lib/queries/field-definitions';
import { FIELD_TYPES, roleAtLeast, type FieldDefinition, type FieldType, type UserRole } from '@/lib/types';
import { EmptyState } from '@/components/empty-state';
import { FieldTypeBadge, fieldTypeIcon } from '@/components/field-type-badge';
import { OptionListEditor } from '@/components/option-list-editor';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { TableSkeleton } from '@/components/table-skeleton';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const OPTION_LIST_TYPES: FieldType[] = ['select', 'multi_select'];

// Handles both "Add field" and "Edit field" — the same shape of form either way, just a POST
// vs. a PATCH and different starting values. A single field prop (undefined = create mode)
// avoids maintaining two near-identical dialogs. The form body is a separate component, keyed
// by the field's id (or 'new'), so it remounts with fresh initial state each time the dialog
// opens for a (possibly different) field — cleaner than an effect resetting state on open.
function FieldDialog({
  contentTypeId,
  field,
  trigger,
}: {
  contentTypeId: string;
  field?: FieldDefinition;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{field ? 'Edit field' : 'Add field'}</DialogTitle>
          <DialogDescription>Fields define what the entry editor renders (§6.1).</DialogDescription>
        </DialogHeader>
        {open ? (
          <FieldForm
            key={field?.id ?? 'new'}
            contentTypeId={contentTypeId}
            field={field}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FieldForm({
  contentTypeId,
  field,
  onDone,
}: {
  contentTypeId: string;
  field: FieldDefinition | undefined;
  onDone: () => void;
}) {
  const isEditing = Boolean(field);
  const [name, setName] = useState(field?.name ?? '');
  const [label, setLabel] = useState(field?.label ?? '');
  const [fieldType, setFieldType] = useState<FieldType>(field?.fieldType ?? 'text');
  const [required, setRequired] = useState(field?.required ?? false);
  const [options, setOptions] = useState<string[]>(
    (field?.config?.options as string[] | undefined) ?? [],
  );
  const [targetContentTypeId, setTargetContentTypeId] = useState(
    (field?.config?.targetContentTypeId as string | undefined) ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const createField = useCreateFieldDefinition(contentTypeId);
  const updateField = useUpdateFieldDefinition(contentTypeId);
  const { data: contentTypes } = useContentTypes();
  const isPending = createField.isPending || updateField.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const config = OPTION_LIST_TYPES.includes(fieldType)
      ? { options }
      : fieldType === 'reference' && targetContentTypeId
        ? { targetContentTypeId }
        : null;

    try {
      if (isEditing && field) {
        await updateField.mutateAsync({ fieldId: field.id, name, label, fieldType, required, config });
        toast.success('Field updated');
      } else {
        await createField.mutateAsync({ name, label, fieldType, required, config });
        toast.success('Field added');
      }
      onDone();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : `Failed to ${isEditing ? 'update' : 'create'} field`;
      setError(message);
      toast.error(message);
    }
  }

  return (
    <>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="field-name">Name</Label>
            <Input
              id="field-name"
              required
              placeholder="title"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="field-label">Label</Label>
            <Input
              id="field-label"
              required
              placeholder="Title"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="field-type">Type</Label>
            <Select value={fieldType} onValueChange={(value) => setFieldType(value as FieldType)}>
              <SelectTrigger id="field-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((type) => {
                  const Icon = fieldTypeIcon(type);
                  return (
                    <SelectItem key={type} value={type}>
                      <Icon className="size-4 text-muted-foreground" />
                      {type}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {OPTION_LIST_TYPES.includes(fieldType) ? <OptionListEditor options={options} onChange={setOptions} /> : null}

          {fieldType === 'reference' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="field-target-content-type">References</Label>
              <Select value={targetContentTypeId} onValueChange={setTargetContentTypeId}>
                <SelectTrigger id="field-target-content-type">
                  <SelectValue placeholder="Choose a content type…" />
                </SelectTrigger>
                <SelectContent>
                  {contentTypes?.map((ct) => (
                    <SelectItem key={ct.id} value={ct.id}>
                      {ct.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Checkbox
              id="field-required"
              checked={required}
              onCheckedChange={(checked) => setRequired(checked === true)}
            />
            <Label htmlFor="field-required">Required</Label>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? (isEditing ? 'Saving…' : 'Adding…') : isEditing ? 'Save field' : 'Add field'}
            </Button>
          </DialogFooter>
        </form>
    </>
  );
}

function EditContentTypeDialog({
  contentTypeId,
  name,
  slug,
  description,
}: {
  contentTypeId: string;
  name: string;
  slug: string;
  description: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit content type</DialogTitle>
          <DialogDescription>
            Renaming or re-slugging doesn't move existing entries, but any public API caller or
            frontend addressing this content type by its old slug will need updating.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ContentTypeForm
            contentTypeId={contentTypeId}
            name={name}
            slug={slug}
            description={description}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// Conditionally rendered only while its dialog is open (see above), which is what gives it
// fresh initial state from props each time it opens rather than a stale draft from before —
// no reset-on-open effect needed.
function ContentTypeForm({
  contentTypeId,
  name,
  slug,
  description,
  onDone,
}: {
  contentTypeId: string;
  name: string;
  slug: string;
  description: string | null;
  onDone: () => void;
}) {
  const [nameValue, setNameValue] = useState(name);
  const [slugValue, setSlugValue] = useState(slug);
  const [descriptionValue, setDescriptionValue] = useState(description ?? '');
  const [error, setError] = useState<string | null>(null);
  const updateContentType = useUpdateContentType(contentTypeId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await updateContentType.mutateAsync({
        name: nameValue,
        slug: slugValue,
        description: descriptionValue || null,
      });
      toast.success('Content type updated');
      onDone();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update content type';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="content-type-edit-name">Name</Label>
        <Input id="content-type-edit-name" required value={nameValue} onChange={(e) => setNameValue(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="content-type-edit-slug">Slug</Label>
        <Input id="content-type-edit-slug" required value={slugValue} onChange={(e) => setSlugValue(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="content-type-edit-description">Description</Label>
        <Input
          id="content-type-edit-description"
          value={descriptionValue}
          onChange={(e) => setDescriptionValue(e.target.value)}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="submit" disabled={updateContentType.isPending}>
          {updateContentType.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function SortableFieldRow({
  field,
  contentTypeId,
  canEdit,
  onRequestDelete,
}: {
  field: FieldDefinition;
  contentTypeId: string;
  canEdit: boolean;
  onRequestDelete: (field: FieldDefinition) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    disabled: !canEdit,
  });

  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 bg-muted' : undefined}
    >
      <TableCell className="w-8">
        {canEdit ? (
          <button
            type="button"
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
            aria-label={`Reorder ${field.label}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
      </TableCell>
      <TableCell className="font-mono text-sm">{field.name}</TableCell>
      <TableCell>{field.label}</TableCell>
      <TableCell>
        <FieldTypeBadge fieldType={field.fieldType} />
      </TableCell>
      <TableCell className="text-muted-foreground">{field.required ? 'Yes' : 'No'}</TableCell>
      <TableCell className="w-20 text-right">
        {canEdit ? (
          <div className="flex justify-end gap-1">
            <FieldDialog
              contentTypeId={contentTypeId}
              field={field}
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${field.label}`}>
                  <Pencil />
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${field.label}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onRequestDelete(field)}
            >
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export function ContentTypeDetailPage() {
  const { contentTypeId } = useParams<{ contentTypeId: string }>();
  const { data: session } = authClient.useSession();
  // Matches the API's own gate (apps/api/src/routes/admin/content-types.ts) — author and
  // viewer can't rename the content type or manage its fields, only admin/editor.
  const canManageFields = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'editor');
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: fields, isPending, error } = useFieldDefinitions(contentTypeId ?? '');
  const reorderFields = useReorderFieldDefinitions(contentTypeId ?? '');
  const deleteField = useDeleteFieldDefinition(contentTypeId ?? '');
  const [pendingDelete, setPendingDelete] = useState<FieldDefinition | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !fields) return;

    const oldIndex = fields.findIndex((field) => field.id === active.id);
    const newIndex = fields.findIndex((field) => field.id === over.id);
    const reordered = arrayMove(fields, oldIndex, newIndex);
    reorderFields.mutate(
      reordered.map((field) => field.id),
      {
        onError: () => toast.error('Failed to reorder fields'),
      },
    );
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteField.mutateAsync(pendingDelete.id);
      toast.success('Field deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete field');
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Content types', to: '/content-types' },
          { label: contentType?.name ?? '…', to: `/content-types/${contentTypeId}` },
          { label: 'Fields' },
        ]}
      />

      <PageHeader
        title={contentType?.name ?? 'Fields'}
        description={
          fields
            ? `${fields.length} ${fields.length === 1 ? 'field' : 'fields'}${contentType?.description ? ` · ${contentType.description}` : ''}`
            : 'Fields define what the entry editor renders.'
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/content-types/${contentTypeId}/entries`}>View entries</Link>
            </Button>
            {canManageFields && contentType && contentTypeId ? (
              <EditContentTypeDialog
                contentTypeId={contentTypeId}
                name={contentType.name}
                slug={contentType.slug}
                description={contentType.description}
              />
            ) : null}
            {canManageFields && contentTypeId ? (
              <FieldDialog
                contentTypeId={contentTypeId}
                trigger={
                  <Button>
                    <Plus />
                    Add field
                  </Button>
                }
              />
            ) : null}
          </>
        }
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {isPending ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Name</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={6} />
          </Table>
        </div>
      ) : null}

      {fields && fields.length === 0 ? (
        <EmptyState
          icon={ListPlus}
          title="No fields yet"
          description="Add fields to define this content type's shape."
        />
      ) : null}

      {fields && fields.length > 0 && contentTypeId ? (
        <div className="rounded-xl border">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Name</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <SortableContext items={fields.map((field) => field.id)} strategy={verticalListSortingStrategy}>
                <TableBody>
                  {fields.map((field) => (
                    <SortableFieldRow
                      key={field.id}
                      field={field}
                      contentTypeId={contentTypeId}
                      canEdit={canManageFields}
                      onRequestDelete={setPendingDelete}
                    />
                  ))}
                </TableBody>
              </SortableContext>
            </Table>
          </DndContext>
        </div>
      ) : null}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pendingDelete?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the field from the content type. Existing entries keep whatever data was
              stored under it, but the entry editor and preview will no longer show it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleConfirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
