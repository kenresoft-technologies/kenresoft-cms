import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { ContentType } from '@/lib/types';

const contentTypesKey = ['content-types'] as const;

export function useContentTypes() {
  return useQuery({
    queryKey: contentTypesKey,
    queryFn: () => apiClient.get<ContentType[]>('/api/v1/admin/content-types'),
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
    mutationFn: (input: { name: string; slug: string; description?: string | null }) =>
      apiClient.post<ContentType>('/api/v1/admin/content-types', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contentTypesKey });
    },
  });
}
