import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { Entry, EntryRevision, EntryStatus } from '@/lib/types';

type EntryWriteInput = {
  slug: string;
  status: EntryStatus;
  data: Record<string, unknown>;
  publishAt?: string | null;
};

export function useEntries(contentTypeId: string) {
  return useQuery({
    queryKey: ['entries', contentTypeId],
    queryFn: () => apiClient.get<Entry[]>(`/api/v1/admin/entries?contentTypeId=${contentTypeId}`),
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

export function useEntryRevisions(entryId: string) {
  return useQuery({
    queryKey: ['entries', 'by-id', entryId, 'revisions'],
    queryFn: () => apiClient.get<EntryRevision[]>(`/api/v1/admin/entries/${entryId}/revisions`),
    enabled: Boolean(entryId),
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
