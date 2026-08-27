import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { Entry, EntryStatus, EntryWithContentType } from '@/lib/types';

// Backs the unified admin Entries view — every entry across every content type. The API's
// GET /api/v1/admin/entries returns this richer, content-type-and-author-joined shape
// whenever contentTypeId is omitted from the query string (see routes/admin/entries.ts).
export function useAllEntries() {
  return useQuery({
    queryKey: ['entries', 'all'],
    queryFn: () => apiClient.get<EntryWithContentType[]>('/api/v1/admin/entries'),
  });
}

// The unified view spans every content type, so — unlike queries/entries.ts's
// useDeleteEntryById/useUpdateEntryStatusById, which are scoped to one contentTypeId known up
// front — these invalidate every 'entries'-prefixed query broadly (the global list, every
// per-content-type list, any open single-entry queries) rather than one specific cache key.
export function useDeleteEntryGlobal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/entries/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['entries'] });
    },
  });
}

export function useUpdateEntryStatusGlobal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: EntryStatus }) =>
      apiClient.patch<Entry>(`/api/v1/admin/entries/${id}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['entries'] });
    },
  });
}
