import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { ApiError } from '@/lib/api-client';
import { useContentType } from '@/lib/queries/content-types';
import { useCreateFieldDefinition, useFieldDefinitions } from '@/lib/queries/field-definitions';
import { FIELD_TYPES, type FieldType } from '@/lib/types';
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

function NewFieldDialog({ contentTypeId }: { contentTypeId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createField = useCreateFieldDefinition(contentTypeId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await createField.mutateAsync({ name, label, fieldType, required });
      setName('');
      setLabel('');
      setFieldType('text');
      setRequired(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create field');
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
  const { projectId, contentTypeId } = useParams<{ projectId: string; contentTypeId: string }>();
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: fields, isPending, error } = useFieldDefinitions(contentTypeId ?? '');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to={`/projects/${projectId}/content-types`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Content types
          </Link>
          <h1 className="text-2xl font-semibold">{contentType?.name ?? 'Fields'}</h1>
        </div>
        {contentTypeId ? <NewFieldDialog contentTypeId={contentTypeId} /> : null}
      </div>

      {isPending ? <p className="text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-destructive">{error.message}</p> : null}

      {fields && fields.length === 0 ? (
        <p className="text-muted-foreground">No fields yet — add one to define this content type.</p>
      ) : null}

      {fields && fields.length > 0 ? (
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
                <TableCell>{field.name}</TableCell>
                <TableCell>{field.label}</TableCell>
                <TableCell className="text-muted-foreground">{field.fieldType}</TableCell>
                <TableCell>{field.required ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
