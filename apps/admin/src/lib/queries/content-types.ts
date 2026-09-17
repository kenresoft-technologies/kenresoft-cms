import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { ContentType, ContentTypeWithCounts } from '@/lib/types';

const contentTypesKey = ['content-types'] as const;

export function useContentTypes() {
  return useQuery({
    queryKey: contentTypesKey,
    queryFn: () => apiClient.get<ContentType[]>('/api/v1/admin/content-types'),
  });
}

// Backs the grid view's cards — one cheap aggregate query on the API side (never N+1 the way the
// old table's per-row field-count cell was), so every card can show field/entry counts without
// its own request.
export function useContentTypesWithCounts() {
  return useQuery({
    queryKey: [...contentTypesKey, 'with-counts'],
    queryFn: () => apiClient.get<ContentTypeWithCounts[]>('/api/v1/admin/content-types/with-counts'),
  });
}

export function useContentType(contentTypeId: string) {
  return useQuery({
    queryKey: ['content-types', 'by-id', contentTypeId],
    queryFn: () => apiClient.get<ContentType>(`/api/v1/admin/content-types/${contentTypeId}`),
    enabled: Boolean(contentTypeId),
  });
}

export function useCreateContentType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; slug: string; description?: string | null; routePattern?: string | null }) =>
      apiClient.post<ContentType>('/api/v1/admin/content-types', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contentTypesKey });
    },
  });
}

export function useUpdateContentType(contentTypeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name?: string; slug?: string; description?: string | null; routePattern?: string | null }) =>
      apiClient.patch<ContentType>(`/api/v1/admin/content-types/${contentTypeId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contentTypesKey });
      void queryClient.invalidateQueries({ queryKey: ['content-types', 'by-id', contentTypeId] });
    },
  });
}
