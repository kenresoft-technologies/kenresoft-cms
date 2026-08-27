import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { EntryRevisionHistory } from '@/components/entry-revision-history';
import { FieldInput } from '@/components/field-input';
import { ApiError } from '@/lib/api-client';
import { useContentType } from '@/lib/queries/content-types';
import { useCreateEntry, useDeleteEntry, useEntry, useUpdateEntry } from '@/lib/queries/entries';
import { useFieldDefinitions } from '@/lib/queries/field-definitions';
import { ENTRY_STATUSES, type Entry, type EntryStatus, type FieldDefinition, type FieldType } from '@/lib/types';
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
import { PageBreadcrumb } from '@/components/page-breadcrumb';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

function defaultValueForType(fieldType: FieldType): unknown {
  return fieldType === 'boolean' ? false : '';
}

// The datetime-local input works in the viewer's local time and has no timezone info, so
// converting to/from it has to go through the local offset by hand rather than a plain
// toISOString/new Date round-trip (which would silently shift the displayed time to UTC).
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

interface EntryFormProps {
  contentTypeId: string;
  entryId: string;
  fields: FieldDefinition[];
  entry: Entry | undefined;
}

function DeleteEntryAlert({ contentTypeId, entryId, slug }: { contentTypeId: string; entryId: string; slug: string }) {
  const navigate = useNavigate();
  const deleteEntry = useDeleteEntry(contentTypeId, entryId);

  async function handleDelete() {
    try {
      await deleteEntry.mutateAsync();
      toast.success('Entry deleted');
      void navigate(`/content-types/${contentTypeId}/entries`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete entry');
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="w-full" disabled={deleteEntry.isPending}>
          Delete entry
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{slug}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the entry and its revision history. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Mounted only once its data (fields, and the entry when editing) has loaded — see the
// loading gate below — so local state can be initialized once via useState's lazy
// initializer instead of syncing it in from a query with useEffect + setState (which
// eslint-plugin-react-hooks flags: react.dev/learn/you-might-not-need-an-effect).
function EntryForm({ contentTypeId, entryId, fields, entry }: EntryFormProps) {
  const isNew = entry === undefined;
  const navigate = useNavigate();
  const createEntry = useCreateEntry(contentTypeId);
  const updateEntry = useUpdateEntry(contentTypeId, entryId);

  const [slug, setSlug] = useState(entry?.slug ?? '');
  const [status, setStatus] = useState<EntryStatus>(entry?.status ?? 'draft');
  const [publishAt, setPublishAt] = useState(() => toDatetimeLocalValue(entry?.publishAt ?? null));
  const [data, setData] = useState<Record<string, unknown>>(() => {
    if (entry) return entry.data;
    const defaults: Record<string, unknown> = {};
    for (const field of fields) {
      defaults[field.name] = defaultValueForType(field.fieldType);
    }
    return defaults;
  });
  const [error, setError] = useState<string | null>(null);

  async function save(statusOverride?: EntryStatus) {
    setError(null);
    const publishAtIso = publishAt ? new Date(publishAt).toISOString() : null;
    const payload = { slug, status: statusOverride ?? status, data, publishAt: publishAtIso };

    try {
      if (isNew) {
        await createEntry.mutateAsync(payload);
        toast.success('Entry created');
      } else {
        await updateEntry.mutateAsync(payload);
        toast.success('Entry saved');
      }
      void navigate(`/content-types/${contentTypeId}/entries`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to save entry';
      setError(message);
      toast.error(message);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  const isSaving = createEntry.isPending || updateEntry.isPending;

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-slug">Slug</Label>
              <Input
                id="entry-slug"
                required
                className="text-base"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
            </div>

            {fields.map((field) => (
              <FieldInput
                key={field.id}
                field={field}
                value={data[field.name]}
                onChange={(value) => setData((prev) => ({ ...prev, [field.name]: value }))}
              />
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Current</span>
                <StatusBadge status={status} />
              </div>
              <Select value={status} onValueChange={(value) => setStatus(value as EntryStatus)}>
                <SelectTrigger id="entry-status" className="w-full">
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
              <div className="flex flex-col gap-2">
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Save entry'}
                </Button>
                {status === 'draft' ? (
                  <Button type="button" variant="outline" disabled={isSaving} onClick={() => void save('published')}>
                    Save &amp; publish
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Publishing</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Label htmlFor="entry-publish-at" className="font-normal text-muted-foreground">
                Schedule publish (optional)
              </Label>
              <Input
                id="entry-publish-at"
                type="datetime-local"
                value={publishAt}
                onChange={(event) => setPublishAt(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to publish only on manual save. If set, a draft entry is
                automatically published once this time passes.
              </p>
            </CardContent>
          </Card>

          {!isNew && entry ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span>{new Date(entry.updatedAt).toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {!isNew ? (
            <EntryRevisionHistory contentTypeId={contentTypeId} entryId={entryId} className="w-full" />
          ) : null}

          {!isNew ? (
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-sm">Danger zone</CardTitle>
              </CardHeader>
              <CardContent>
                <DeleteEntryAlert contentTypeId={contentTypeId} entryId={entryId} slug={entry?.slug ?? ''} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

export function EntryEditorPage() {
  const { contentTypeId, entryId } = useParams<{
    contentTypeId: string;
    entryId: string;
  }>();
  const isNew = entryId === 'new';

  const { data: contentType } = useContentType(contentTypeId ?? '');
  const { data: fields } = useFieldDefinitions(contentTypeId ?? '');
  const { data: entry } = useEntry(isNew ? '' : (entryId ?? ''));
  const ready = Boolean(fields) && (isNew || Boolean(entry));

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumb
        items={[
          { label: 'Content types', to: '/content-types' },
          {
            label: contentType?.name ?? '…',
            to: `/content-types/${contentTypeId}`,
          },
          {
            label: 'Entries',
            to: `/content-types/${contentTypeId}/entries`,
          },
          { label: isNew ? 'New' : (entry?.slug ?? '…') },
        ]}
      />

      <PageHeader
        title={isNew ? 'New entry' : (entry?.slug ?? 'Edit entry')}
        description={
          contentType
            ? `${isNew ? 'Creating a new' : 'Editing an'} instance of ${contentType.name}.`
            : isNew
              ? 'Creating a new entry.'
              : 'Editing an entry.'
        }
      />

      {!ready ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card className="h-fit">
            <CardContent className="flex flex-col gap-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}

      {ready && contentTypeId && entryId ? (
        <EntryForm
          key={`${entryId}-${entry?.updatedAt ?? 'new'}`}
          contentTypeId={contentTypeId}
          entryId={entryId}
          fields={fields!}
          entry={isNew ? undefined : entry}
        />
      ) : null}
    </div>
  );
}
