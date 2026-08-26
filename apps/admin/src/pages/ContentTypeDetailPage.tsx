import { useState, type FormEvent } from 'react';
import { ListPlus, Trash2 } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useContentType, useContentTypes } from '@/lib/queries/content-types';
import { useCreateFieldDefinition, useFieldDefinitions } from '@/lib/queries/field-definitions';
import { FIELD_TYPES, type FieldType } from '@/lib/types';
import { EmptyState } from '@/components/empty-state';
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

const OPTION_LIST_TYPES: FieldType[] = ['select', 'multi_select'];

function OptionListEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [newOption, setNewOption] = useState('');

  function addOption() {
    const trimmed = newOption.trim();
    if (!trimmed || options.includes(trimmed)) return;
    onChange([...options, trimmed]);
    setNewOption('');
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Options</Label>
      {options.length === 0 ? <p className="text-sm text-muted-foreground">No options yet.</p> : null}
      {options.map((option, index) => (
        <div key={option} className="flex items-center gap-2">
          <span className="flex-1 text-sm">{option}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${option}`}
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          placeholder="option value"
          value={newOption}
          onChange={(event) => setNewOption(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addOption();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={addOption}>
          Add
        </Button>
      </div>
    </div>
  );
}

function NewFieldDialog({ contentTypeId }: { contentTypeId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [targetContentTypeId, setTargetContentTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createField = useCreateFieldDefinition(contentTypeId);
  const { data: contentTypes } = useContentTypes();

  function resetForm() {
    setName('');
    setLabel('');
    setFieldType('text');
    setRequired(false);
    setOptions([]);
    setTargetContentTypeId('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const config = OPTION_LIST_TYPES.includes(fieldType)
      ? { options }
      : fieldType === 'reference' && targetContentTypeId
        ? { targetContentTypeId }
        : null;

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
          <DialogDescription>Fields define what the entry editor renders (§6.1).</DialogDescription>
        </DialogHeader>
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
                {FIELD_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
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
            <Button type="submit" disabled={createField.isPending}>
              {createField.isPending ? 'Adding…' : 'Add field'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ContentTypeDetailPage() {
  const { contentTypeId } = useParams<{ contentTypeId: string }>();
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: fields, isPending, error } = useFieldDefinitions(contentTypeId ?? '');

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Content types', to: '/content-types' },
          { label: contentType?.name ?? '…' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{contentType?.name ?? 'Fields'}</h1>
          <p className="text-muted-foreground">Fields define what the entry editor renders.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to={`/content-types/${contentTypeId}/entries`}>View entries</Link>
          </Button>
          {contentTypeId ? <NewFieldDialog contentTypeId={contentTypeId} /> : null}
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
        <EmptyState
          icon={ListPlus}
          title="No fields yet"
          description="Add fields to define this content type's shape."
        />
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
                  <TableCell className="text-muted-foreground">
                    {field.required ? 'Yes' : 'No'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
