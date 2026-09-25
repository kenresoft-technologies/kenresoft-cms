import { useState, type FormEvent } from 'react';
import { ListChecks, ListPlus, Mail, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useDeveloperMode } from '@/lib/developer-mode';
import { useForm, useUpdateForm } from '@/lib/queries/forms';
import { useCreateFormField, useDeleteFormField, useFormFields, useUpdateFormField } from '@/lib/queries/form-fields';
import { FORM_FIELD_TYPES, roleAtLeast, type Form, type FormField, type FormFieldType, type UserRole } from '@/lib/types';
import { EmptyState } from '@/components/empty-state';
import { FormDeveloperPanel } from '@/components/developer-panel/form-developer-panel';
import { FieldTypeBadge, fieldTypeIcon } from '@/components/field-type-badge';
import { FormBadge } from '@/components/form-badge';
import { FormTestDialog } from '@/components/form-test-dialog';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
      <DialogContent size="md">
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

function EditFormDialog({ form }: { form: Form }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit form</DialogTitle>
          <DialogDescription>
            Re-slugging changes the public submission URL. Anything posting to the old
            slug will need updating.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <EditFormForm form={form} onDone={() => setOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// Parses a freeform, comma/newline-separated textarea into the array notificationEmails
// actually expects — deliberately not a dedicated tag-input widget (no such component exists
// elsewhere in this app yet, and a handful of email addresses per form doesn't warrant one).
// A syntactically invalid entry is caught by the server's own z.string().email() validation on
// save (surfaced via the existing ApiError message), not duplicated here.
function parseEmailList(raw: string): string[] {
  return [...new Set(raw.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean))];
}

// One stage per line, in order; blank lines are ignored.
function parseStageList(raw: string): string[] {
  return raw.split('\n').map((entry) => entry.trim()).filter(Boolean);
}

function EditFormForm({ form, onDone }: { form: Form; onDone: () => void }) {
  const [nameValue, setNameValue] = useState(form.name);
  const [slugValue, setSlugValue] = useState(form.slug);
  const [notificationEmailsValue, setNotificationEmailsValue] = useState((form.notificationEmails ?? []).join(', '));
  const [requiresAccount, setRequiresAccount] = useState(form.requiresAccount);
  const [stagesValue, setStagesValue] = useState((form.stages ?? []).join('\n'));
  const [accountUrlValue, setAccountUrlValue] = useState(form.accountSubmissionUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const updateForm = useUpdateForm(form.id);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsedEmails = parseEmailList(notificationEmailsValue);
    const parsedStages = parseStageList(stagesValue);
    try {
      await updateForm.mutateAsync({
        name: nameValue,
        slug: slugValue,
        notificationEmails: parsedEmails.length > 0 ? parsedEmails : null,
        requiresAccount,
        stages: parsedStages.length > 0 ? parsedStages : null,
        accountSubmissionUrl: accountUrlValue.trim() || null,
      });
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
      <div className="flex flex-col gap-2">
        <Label htmlFor="form-edit-notifications">Notification emails</Label>
        <Textarea
          id="form-edit-notifications"
          rows={2}
          placeholder="hr@example.com, ops@example.com"
          value={notificationEmailsValue}
          onChange={(e) => setNotificationEmailsValue(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated. Each address gets an email whenever this form is submitted. Leave
          blank to disable.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="form-edit-stages">Progress stages</Label>
        <Textarea
          id="form-edit-stages"
          rows={4}
          placeholder={'Submitted\nIn Progress\nCompleted'}
          value={stagesValue}
          onChange={(e) => setStagesValue(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          One per line, in order. New submissions start in the first stage, and you move them along from
          each submission. Leave blank for no stages.
        </p>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="form-edit-requires-account"
          className="mt-0.5"
          checked={requiresAccount}
          onCheckedChange={(checked) => setRequiresAccount(checked === true)}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="form-edit-requires-account">Require a website account</Label>
          <p className="text-xs text-muted-foreground">
            Only signed-in website accounts can submit. Each submission belongs to its account, which can
            follow its stage, read your replies, send messages and download files from your site.
          </p>
        </div>
      </div>
      {requiresAccount ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="form-edit-account-url">Account page URL</Label>
          <Input
            id="form-edit-account-url"
            type="url"
            placeholder="https://example.com/account/requests/{id}"
            value={accountUrlValue}
            onChange={(e) => setAccountUrlValue(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Where a submitter views a submission on your site. <code>{'{id}'}</code> is replaced with the
            submission&apos;s id. Stage-change emails and replies link here; without it, no stage-change
            email is sent.
          </p>
        </div>
      ) : null}
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
  const developerMode = useDeveloperMode();
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
            {formId && fields && fields.length > 0 ? <FormTestDialog formId={formId} fields={fields} /> : null}
            {developerMode && form && fields ? <FormDeveloperPanel form={form} fields={fields} /> : null}
            {canManageFields && form && formId ? (
              <EditFormDialog form={form} />
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

      {form && formId ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <FormBadge id={formId} name={form.name} />
            <Badge variant="outline" className="font-mono font-normal text-muted-foreground">
              {form.slug}
            </Badge>
            {form.notificationEmails && form.notificationEmails.length > 0 ? (
              <Badge variant="secondary" className="gap-1 font-normal" title={form.notificationEmails.join(', ')}>
                <Mail className="size-3" />
                Notifies {form.notificationEmails.length}{' '}
                {form.notificationEmails.length === 1 ? 'address' : 'addresses'}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                <Mail className="size-3" />
                No notifications configured
              </Badge>
            )}
            {form.requiresAccount ? (
              <Badge variant="secondary" className="gap-1 font-normal">
                <UserRound className="size-3" />
                Requires an account
              </Badge>
            ) : null}
            {form.stages?.length ? (
              <Badge variant="secondary" className="gap-1 font-normal" title={form.stages.join(' → ')}>
                <ListChecks className="size-3" />
                {form.stages.length} stages
              </Badge>
            ) : null}
            <span className="ml-auto text-sm text-muted-foreground">
              {fields?.length ?? 0} {fields?.length === 1 ? 'field' : 'fields'}
            </span>
          </CardContent>
        </Card>
      ) : null}

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
                  <TableCell>
                    {field.required ? (
                      <Badge variant="secondary" className="font-normal">
                        Required
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Optional</span>
                    )}
                  </TableCell>
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
