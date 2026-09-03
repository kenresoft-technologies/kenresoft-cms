import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  ContentTypeExport,
  Entry,
  EntryRevision,
  EntryStatus,
  EntryWithContentType,
  ImportEntriesResult,
} from '@/lib/types';

type EntryWriteInput = {
  slug: string;
  status: EntryStatus;
  data: Record<string, unknown>;
  publishAt?: string | null;
};

// The API returns the same joined shape (content type + author) whether or not
// contentTypeId is set — scoped here to one content type, so this page can show an Author
// column too, not just the unified AllEntriesPage.
export function useEntries(contentTypeId: string) {
  return useQuery({
    queryKey: ['entries', contentTypeId],
    queryFn: () =>
      apiClient.get<EntryWithContentType[]>(`/api/v1/admin/entries?contentTypeId=${contentTypeId}`),
    enabled: Boolean(contentTypeId),
  });
}

export function useEntry(id: string) {
  return useQuery({
    queryKey: ['entries', 'by-id', id],
    queryFn: () => apiClient.get<Entry>(`/api/v1/admin/entries/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateEntry(contentTypeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: EntryWriteInput) =>
      apiClient.post<Entry>(`/api/v1/admin/entries?contentTypeId=${contentTypeId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['entries', contentTypeId] });
    },
  });
}

export function useUpdateEntry(contentTypeId: string, id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: EntryWriteInput) => apiClient.patch<Entry>(`/api/v1/admin/entries/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['entries', contentTypeId] });
      void queryClient.invalidateQueries({ queryKey: ['entries', 'by-id', id] });
    },
  });
}

export function useDeleteEntry(contentTypeId: string, id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.delete<void>(`/api/v1/admin/entries/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['entries', contentTypeId] });
    },
  });
}

// Row/bulk actions on a list page need to delete or change the status of whichever entry the
// user just acted on, not one fixed id known when the component mounts — unlike
// useDeleteEntry/useUpdateEntry above (built for the single-entry editor, where the id is
// fixed for the page's lifetime), these take the id as a mutate-time argument so one hook
// instance at the list page's top level covers every row.
export function useDeleteEntryById(contentTypeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/entries/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['entries', contentTypeId] });
    },
  });
}

export function useUpdateEntryStatusById(contentTypeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: EntryStatus }) =>
      apiClient.patch<Entry>(`/api/v1/admin/entries/${id}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['entries', contentTypeId] });
    },
  });
}

export function useEntryRevisions(entryId: string) {
  return useQuery({
    queryKey: ['entries', 'by-id', entryId, 'revisions'],
    queryFn: () => apiClient.get<EntryRevision[]>(`/api/v1/admin/entries/${entryId}/revisions`),
    enabled: Boolean(entryId),
  });
}

// Not a useQuery — export is triggered on demand (a button click that immediately downloads a
// file), not something rendered on the page, so a plain async fetch avoids caching a payload
// that's never displayed anywhere.
export async function exportEntries(contentTypeId: string): Promise<ContentTypeExport> {
  return apiClient.get<ContentTypeExport>(`/api/v1/admin/entries/export?contentTypeId=${contentTypeId}`);
}

export function useImportEntries(contentTypeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ContentTypeExport) =>
      apiClient.post<ImportEntriesResult>(`/api/v1/admin/entries/import?contentTypeId=${contentTypeId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['entries', contentTypeId] });
    },
  });
}

export function useRestoreEntryRevision(contentTypeId: string, entryId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (revisionId: string) =>
      apiClient.post<Entry>(`/api/v1/admin/entries/${entryId}/revisions/${revisionId}/restore`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['entries', contentTypeId] });
      void queryClient.invalidateQueries({ queryKey: ['entries', 'by-id', entryId] });
    },
  });
}
