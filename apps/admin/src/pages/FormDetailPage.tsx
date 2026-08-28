import { useState, type FormEvent } from 'react';
import { ListPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useForm, useUpdateForm } from '@/lib/queries/forms';
import { useCreateFormField, useDeleteFormField, useFormFields, useUpdateFormField } from '@/lib/queries/form-fields';
import { FORM_FIELD_TYPES, roleAtLeast, type FormField, type FormFieldType, type UserRole } from '@/lib/types';
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

// Handles both "Add field" and "Edit field" — see the identical pattern (and rationale) in
// ContentTypeDetailPage.tsx's FieldDialog: the form body only mounts while open, so it always
// starts from fresh props-derived state instead of needing a reset-on-open effect.
function FormFieldDialog({
  formId,
  field,
  trigger,
}: {
  formId: string;
  field?: FormField;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{field ? 'Edit field' : 'Add field'}</DialogTitle>
          <DialogDescription>Fields define what a submitter fills in (§7).</DialogDescription>
        </DialogHeader>
        {open ? <FormFieldForm key={field?.id ?? 'new'} formId={formId} field={field} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function FormFieldForm({
  formId,
  field,
  onDone,
}: {
  formId: string;
  field: FormField | undefined;
  onDone: () => void;
}) {
  const isEditing = Boolean(field);
  const [name, setName] = useState(field?.name ?? '');
  const [label, setLabel] = useState(field?.label ?? '');
  const [fieldType, setFieldType] = useState<FormFieldType>(field?.fieldType ?? 'text');
  const [required, setRequired] = useState(field?.required ?? false);
  const [options, setOptions] = useState<string[]>((field?.config?.options as string[] | undefined) ?? []);
  const [error, setError] = useState<string | null>(null);
  const createField = useCreateFormField(formId);
  const updateField = useUpdateFormField(formId);
  const isPending = createField.isPending || updateField.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const config = fieldType === 'select' ? { options } : null;

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
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="form-field-name">Name</Label>
        <Input
          id="form-field-name"
          required
          placeholder="email"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="form-field-label">Label</Label>
        <Input
          id="form-field-label"
          required
          placeholder="Email"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="form-field-type">Type</Label>
        <Select value={fieldType} onValueChange={(value) => setFieldType(value as FormFieldType)}>
          <SelectTrigger id="form-field-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORM_FIELD_TYPES.map((type) => {
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

      {fieldType === 'select' ? <OptionListEditor options={options} onChange={setOptions} /> : null}

      <div className="flex items-center gap-2">
        <Checkbox
          id="form-field-required"
          checked={required}
          onCheckedChange={(checked) => setRequired(checked === true)}
        />
        <Label htmlFor="form-field-required">Required</Label>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="submit" disabled={isPending}>
          {isPending ? (isEditing ? 'Saving…' : 'Adding…') : isEditing ? 'Save field' : 'Add field'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditFormDialog({ formId, name, slug }: { formId: string; name: string; slug: string }) {
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
          <DialogTitle>Edit form</DialogTitle>
          <DialogDescription>
            Re-slugging changes the public submission URL — anything currently posting to the old
            slug will need updating.
          </DialogDescription>
        </DialogHeader>
        {open ? <EditFormForm formId={formId} name={name} slug={slug} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditFormForm({
  formId,
  name,
  slug,
  onDone,
}: {
  formId: string;
  name: string;
  slug: string;
  onDone: () => void;
}) {
  const [nameValue, setNameValue] = useState(name);
  const [slugValue, setSlugValue] = useState(slug);
  const [error, setError] = useState<string | null>(null);
  const updateForm = useUpdateForm(formId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await updateForm.mutateAsync({ name: nameValue, slug: slugValue });
      toast.success('Form updated');
      onDone();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update form';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="form-edit-name">Name</Label>
        <Input id="form-edit-name" required value={nameValue} onChange={(e) => setNameValue(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="form-edit-slug">Slug</Label>
        <Input id="form-edit-slug" required value={slugValue} onChange={(e) => setSlugValue(e.target.value)} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="submit" disabled={updateForm.isPending}>
          {updateForm.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function FormDetailPage() {
  const { formId } = useParams<{ formId: string }>();
  const { data: session } = authClient.useSession();
  // Matches the API's own gate (apps/api/src/routes/admin/forms.ts) — author and viewer
  // can't rename the form or manage its fields, only admin/editor.
  const canManageFields = roleAtLeast((session?.user.role ?? 'viewer') as UserRole, 'editor');
  const { data: form } = useForm(formId ?? '');
  const { data: fields, isPending, error } = useFormFields(formId ?? '');
  const deleteField = useDeleteFormField(formId ?? '');
  const [pendingDelete, setPendingDelete] = useState<FormField | null>(null);

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
          { label: 'Forms', to: '/forms' },
          { label: form?.name ?? '…', to: `/forms/${formId}` },
          { label: 'Fields' },
        ]}
      />

      <PageHeader
        title={form?.name ?? 'Fields'}
        description={fields ? `${fields.length} ${fields.length === 1 ? 'field' : 'fields'}` : 'Fields define what a submitter fills in.'}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/forms/${formId}/submissions`}>View submissions</Link>
            </Button>
            {canManageFields && form && formId ? (
              <EditFormDialog formId={formId} name={form.name} slug={form.slug} />
            ) : null}
            {canManageFields && formId ? (
              <FormFieldDialog
                formId={formId}
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
                <TableHead>Name</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={5} />
          </Table>
        </div>
      ) : null}

      {fields && fields.length === 0 ? (
        <EmptyState icon={ListPlus} title="No fields yet" description="Add fields to define this form's shape." />
      ) : null}

      {fields && fields.length > 0 && formId ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field) => (
                <TableRow key={field.id}>
                  <TableCell className="font-mono text-sm">{field.name}</TableCell>
                  <TableCell>{field.label}</TableCell>
                  <TableCell>
                    <FieldTypeBadge fieldType={field.fieldType} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{field.required ? 'Yes' : 'No'}</TableCell>
                  <TableCell className="w-20 text-right">
                    {canManageFields ? (
                      <div className="flex justify-end gap-1">
                        <FormFieldDialog
                          formId={formId}
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
                          onClick={() => setPendingDelete(field)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pendingDelete?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the field from the form. Existing submissions keep whatever data was
              collected under it.
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
