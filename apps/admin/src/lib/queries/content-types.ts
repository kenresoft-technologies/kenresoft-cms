import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { ContentType } from '@/lib/types';

export function useContentTypes(projectId: string) {
  return useQuery({
    queryKey: ['content-types', projectId],
    queryFn: () =>
      apiClient.get<ContentType[]>(`/api/v1/admin/content-types?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
}

export function useContentType(contentTypeId: string) {
  return useQuery({
    queryKey: ['content-types', 'by-id', contentTypeId],
    queryFn: () => apiClient.get<ContentType>(`/api/v1/admin/content-types/${contentTypeId}`),
    enabled: Boolean(contentTypeId),
  });
}

export function useCreateContentType(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; slug: string; description?: string | null }) =>
      apiClient.post<ContentType>('/api/v1/admin/content-types', { ...input, projectId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['content-types', projectId] });
    },
  });
}
