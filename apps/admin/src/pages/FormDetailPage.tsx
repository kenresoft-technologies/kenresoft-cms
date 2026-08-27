import { useState, type FormEvent } from 'react';
import { ListPlus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useForm } from '@/lib/queries/forms';
import { useCreateFormField, useFormFields } from '@/lib/queries/form-fields';
import { FORM_FIELD_TYPES, type FormFieldType } from '@/lib/types';
import { EmptyState } from '@/components/empty-state';
import { OptionListEditor } from '@/components/option-list-editor';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
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

function NewFormFieldDialog({ formId }: { formId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<FormFieldType>('text');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createField = useCreateFormField(formId);

  function resetForm() {
    setName('');
    setLabel('');
    setFieldType('text');
    setRequired(false);
    setOptions([]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const config = fieldType === 'select' ? { options } : null;

    try {
      await createField.mutateAsync({ name, label, fieldType, required, config });
      toast.success('Field added');
      resetForm();
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create field';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add field</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add field</DialogTitle>
          <DialogDescription>Fields define what a submitter fills in (§7).</DialogDescription>
        </DialogHeader>
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
                {FORM_FIELD_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
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
            <Button type="submit" disabled={createField.isPending}>
              {createField.isPending ? 'Adding…' : 'Add field'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FormDetailPage() {
  const { formId } = useParams<{ formId: string }>();
  const { data: form } = useForm(formId ?? '');
  const { data: fields, isPending, error } = useFormFields(formId ?? '');

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Forms', to: '/forms' },
          { label: form?.name ?? '…', to: `/forms/${formId}` },
          { label: 'Fields' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{form?.name ?? 'Fields'}</h1>
          <p className="text-muted-foreground">Fields define what a submitter fills in.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to={`/forms/${formId}/submissions`}>View submissions</Link>
          </Button>
          {formId ? <NewFormFieldDialog formId={formId} /> : null}
        </div>
      </div>

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
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={4} />
          </Table>
        </div>
      ) : null}

      {fields && fields.length === 0 ? (
        <EmptyState icon={ListPlus} title="No fields yet" description="Add fields to define this form's shape." />
      ) : null}

      {fields && fields.length > 0 ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field) => (
                <TableRow key={field.id}>
                  <TableCell className="font-mono text-sm">{field.name}</TableCell>
                  <TableCell>{field.label}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{field.fieldType}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{field.required ? 'Yes' : 'No'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
