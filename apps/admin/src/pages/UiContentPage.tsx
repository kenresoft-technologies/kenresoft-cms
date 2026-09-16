import { useState } from 'react';
import { PanelsTopLeft, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api-client';
import {
  useCreateUiContentType,
  useDeleteUiContentType,
  useUiContentTypes,
} from '@/lib/queries/ui-content';
import { FIELD_TYPES, roleAtLeast } from '@/lib/types';
import type { FieldType, UiContentType, UserRole } from '@/lib/types';
import { authClient } from '@/lib/auth-client';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface DraftField {
  name: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function CreateUiContentTypeDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [fields, setFields] = useState<DraftField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createType = useCreateUiContentType();

  function addField() {
    setFields((prev) => [...prev, { name: '', label: '', fieldType: 'text', required: false }]);
  }

  function updateField(index: number, patch: Partial<DraftField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setError(null);
    const slug = slugify(name);
    if (!slug) {
      setError('Enter a name');
      return;
    }
    if (fields.some((f) => !f.name.trim() || !f.label.trim())) {
      setError('Every field needs a name and a label');
      return;
    }

    try {
      await createType.mutateAsync({
        name,
        slug,
        fields: fields.map((f) => ({ ...f, config: {} })),
      });
      toast.success('UI content type created');
      setName('');
      setFields([]);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create UI content type');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Create type
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a UI content type</DialogTitle>
          <DialogDescription>
            A small, independently-managed content object (Hero, Carousel, Promo Banner, …) — not
            an Entry, not a Reusable Block.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="uict-name">Name</Label>
            <Input id="uict-name" placeholder="Hero" value={name} onChange={(event) => setName(event.target.value)} />
            {name ? <p className="text-xs text-muted-foreground">Slug: {slugify(name) || '—'}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Fields</Label>
              <Button type="button" variant="outline" size="sm" onClick={addField}>
                <Plus />
                Add field
              </Button>
            </div>
            {fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">No fields yet — add at least one to store structured data.</p>
            ) : null}
            <div className="flex flex-col gap-2">
              {fields.map((field, index) => (
                <div key={index} className="flex items-end gap-2 rounded-lg border p-2">
                  <div className="flex flex-1 flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">Name</Label>
                    <Input
                      value={field.name}
                      placeholder="heading"
                      onChange={(event) => updateField(index, { name: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">Label</Label>
                    <Input
                      value={field.label}
                      placeholder="Heading"
                      onChange={(event) => updateField(index, { label: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">Type</Label>
                    <Select value={field.fieldType} onValueChange={(value) => updateField(index, { fieldType: value as FieldType })}>
                      <SelectTrigger className="w-32">
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
                  <label className="flex items-center gap-1.5 pb-2 text-xs">
                    <Checkbox checked={field.required} onCheckedChange={(checked) => updateField(index, { required: checked === true })} />
                    Required
                  </label>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove field" onClick={() => removeField(index)}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={() => void handleSubmit()} disabled={createType.isPending}>
            {createType.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UiContentTypeCard({ type, canManage }: { type: UiContentType; canManage: boolean }) {
  const navigate = useNavigate();
  const deleteType = useDeleteUiContentType();

  async function handleDelete() {
    try {
      await deleteType.mutateAsync(type.id);
      toast.success('UI content type deleted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete UI content type');
    }
  }

  return (
    <Card className="cursor-pointer transition-colors hover:border-primary/40" onClick={() => navigate(`/ui-content/${type.id}`)}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">{type.name}</CardTitle>
          <p className="font-mono text-xs text-muted-foreground">{type.slug}</p>
        </div>
        {canManage ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive"
                aria-label={`Delete ${type.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent onClick={(event) => event.stopPropagation()}>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{type.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This also deletes every item of this type. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{type.fields.length} field{type.fields.length === 1 ? '' : 's'}</p>
      </CardContent>
    </Card>
  );
}

export function UiContentPage() {
  const { data: session } = authClient.useSession();
  const { data: types, isPending, error } = useUiContentTypes();
  const canManage = roleAtLeast((session?.user.role as UserRole | undefined) ?? 'viewer', 'editor');

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb items={[{ label: 'UI content' }]} />
      <PageHeader
        title="UI content"
        description="Independently-managed content objects (Hero, Carousel, Promo Banner, …) — not Entries, not Reusable Blocks."
        actions={canManage ? <CreateUiContentTypeDialog /> : undefined}
      />

      {error ? <p className="text-destructive">{error.message}</p> : null}

      {!isPending && types && types.length === 0 ? (
        <EmptyState
          icon={PanelsTopLeft}
          title="No UI content types yet"
          description="Create one to start managing structured UI objects like Hero sections or Testimonials."
        />
      ) : null}

      {types && types.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((type) => (
            <UiContentTypeCard key={type.id} type={type} canManage={canManage} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
