import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';

import { FieldInput } from '@/components/field-input';
import { ApiError } from '@/lib/api-client';
import { useContentType } from '@/lib/queries/content-types';
import { useCreateEntry, useEntry, useUpdateEntry } from '@/lib/queries/entries';
import { useFieldDefinitions } from '@/lib/queries/field-definitions';
import { useProject } from '@/lib/queries/projects';
import { ENTRY_STATUSES, type Entry, type EntryStatus, type FieldDefinition, type FieldType } from '@/lib/types';
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

function defaultValueForType(fieldType: FieldType): unknown {
  return fieldType === 'boolean' ? false : '';
}

interface EntryFormProps {
  projectId: string;
  contentTypeId: string;
  entryId: string;
  fields: FieldDefinition[];
  entry: Entry | undefined;
}

// Mounted only once its data (fields, and the entry when editing) has loaded — see the
// loading gate below — so local state can be initialized once via useState's lazy
// initializer instead of syncing it in from a query with useEffect + setState (which
// eslint-plugin-react-hooks flags: react.dev/learn/you-might-not-need-an-effect).
function EntryForm({ projectId, contentTypeId, entryId, fields, entry }: EntryFormProps) {
  const isNew = entry === undefined;
  const navigate = useNavigate();
  const createEntry = useCreateEntry(contentTypeId);
  const updateEntry = useUpdateEntry(contentTypeId, entryId);

  const [slug, setSlug] = useState(entry?.slug ?? '');
  const [status, setStatus] = useState<EntryStatus>(entry?.status ?? 'draft');
  const [data, setData] = useState<Record<string, unknown>>(() => {
    if (entry) return entry.data;
    const defaults: Record<string, unknown> = {};
    for (const field of fields) {
      defaults[field.name] = defaultValueForType(field.fieldType);
    }
    return defaults;
  });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      if (isNew) {
        await createEntry.mutateAsync({ slug, status, data });
      } else {
        await updateEntry.mutateAsync({ slug, status, data });
      }
      void navigate(`/projects/${projectId}/content-types/${contentTypeId}/entries`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save entry');
    }
  }

  const isSaving = createEntry.isPending || updateEntry.isPending;

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="entry-slug">Slug</Label>
        <Input id="entry-slug" required value={slug} onChange={(event) => setSlug(event.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="entry-status">Status</Label>
        <Select value={status} onValueChange={(value) => setStatus(value as EntryStatus)}>
          <SelectTrigger id="entry-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTRY_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {fields.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          value={data[field.name]}
          onChange={(value) => setData((prev) => ({ ...prev, [field.name]: value }))}
        />
      ))}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save entry'}
        </Button>
      </div>
    </form>
  );
}

export function EntryEditorPage() {
  const { projectId, contentTypeId, entryId } = useParams<{
    projectId: string;
    contentTypeId: string;
    entryId: string;
  }>();
  const isNew = entryId === 'new';

  const { data: project } = useProject(projectId ?? '');
  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: fields } = useFieldDefinitions(contentTypeId ?? '');
  const { data: entry } = useEntry(isNew ? '' : (entryId ?? ''));
  const ready = Boolean(fields) && (isNew || Boolean(entry));

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Projects', to: '/projects' },
          { label: project?.name ?? '…', to: `/projects/${projectId}/content-types` },
          {
            label: contentType?.name ?? '…',
            to: `/projects/${projectId}/content-types/${contentTypeId}`,
          },
          {
            label: 'Entries',
            to: `/projects/${projectId}/content-types/${contentTypeId}/entries`,
          },
          { label: isNew ? 'New' : (entry?.slug ?? '…') },
        ]}
      />

      <h1 className="text-2xl font-semibold">{isNew ? 'New entry' : 'Edit entry'}</h1>

      {!ready ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ) : null}

      {ready && projectId && contentTypeId && entryId ? (
        <Card>
          <CardContent>
            <EntryForm
              key={entryId}
              projectId={projectId}
              contentTypeId={contentTypeId}
              entryId={entryId}
              fields={fields!}
              entry={isNew ? undefined : entry}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
