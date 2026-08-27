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
import { GripVertical, ListPlus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import { useContentType, useContentTypes } from '@/lib/queries/content-types';
import {
  useCreateFieldDefinition,
  useFieldDefinitions,
  useReorderFieldDefinitions,
} from '@/lib/queries/field-definitions';
import { FIELD_TYPES, type FieldDefinition, type FieldType } from '@/lib/types';
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

const OPTION_LIST_TYPES: FieldType[] = ['select', 'multi_select'];

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

function SortableFieldRow({ field }: { field: FieldDefinition }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });

  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 bg-muted' : undefined}
    >
      <TableCell className="w-8">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label={`Reorder ${field.label}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      </TableCell>
      <TableCell className="font-mono text-sm">{field.name}</TableCell>
      <TableCell>{field.label}</TableCell>
      <TableCell>
        <Badge variant="outline">{field.fieldType}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{field.required ? 'Yes' : 'No'}</TableCell>
    </TableRow>
  );
}

export function ContentTypeDetailPage() {
  const { contentTypeId } = useParams<{ contentTypeId: string }>();
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: fields, isPending, error } = useFieldDefinitions(contentTypeId ?? '');
  const reorderFields = useReorderFieldDefinitions(contentTypeId ?? '');
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

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Content types', to: '/content-types' },
          { label: contentType?.name ?? '…', to: `/content-types/${contentTypeId}` },
          { label: 'Fields' },
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
                <TableHead className="w-8" />
                <TableHead>Name</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton columns={5} />
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Name</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required</TableHead>
                </TableRow>
              </TableHeader>
              <SortableContext items={fields.map((field) => field.id)} strategy={verticalListSortingStrategy}>
                <TableBody>
                  {fields.map((field) => (
                    <SortableFieldRow key={field.id} field={field} />
                  ))}
                </TableBody>
              </SortableContext>
            </Table>
          </DndContext>
        </div>
      ) : null}
    </div>
  );
}
