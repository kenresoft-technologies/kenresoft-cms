import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { EntryFolder, EntryWithContentType } from '@/lib/types';

const entryFoldersKey = (contentTypeId: string) => ['entry-folders', contentTypeId] as const;

export function useEntryFolders(contentTypeId: string) {
  return useQuery({
    queryKey: entryFoldersKey(contentTypeId),
    queryFn: () =>
      apiClient.get<EntryFolder[]>(`/api/v1/admin/entry-folders?contentTypeId=${encodeURIComponent(contentTypeId)}`),
    enabled: Boolean(contentTypeId),
  });
}

export function useCreateEntryFolder(contentTypeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; parentId?: string | null }) =>
      apiClient.post<EntryFolder>(`/api/v1/admin/entry-folders?contentTypeId=${encodeURIComponent(contentTypeId)}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: entryFoldersKey(contentTypeId) });
    },
  });
}

export function useUpdateEntryFolder(contentTypeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; parentId?: string | null }) =>
      apiClient.patch<EntryFolder>(`/api/v1/admin/entry-folders/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: entryFoldersKey(contentTypeId) });
    },
  });
}

export function useDeleteEntryFolder(contentTypeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/entry-folders/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: entryFoldersKey(contentTypeId) });
      void queryClient.invalidateQueries({ queryKey: ['entries', contentTypeId] });
    },
  });
}

export function useMoveEntries(contentTypeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { entryIds: string[]; folderId: string | null }) =>
      apiClient.post<EntryWithContentType[]>('/api/v1/admin/entry-folders/move', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['entries', contentTypeId] });
    },
  });
}
