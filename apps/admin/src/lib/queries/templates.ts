import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { BlockInstance, Template } from '@/lib/types';

type TemplateWriteInput = {
  name?: string;
  contentTypeId?: string | null;
  blocks?: BlockInstance[];
  isDefault?: boolean;
};

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => apiClient.get<Template[]>('/api/v1/admin/templates'),
  });
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: ['templates', 'by-id', id],
    queryFn: () => apiClient.get<Template>(`/api/v1/admin/templates/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TemplateWriteInput) => apiClient.post<Template>('/api/v1/admin/templates', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useUpdateTemplate(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TemplateWriteInput) => apiClient.patch<Template>(`/api/v1/admin/templates/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useDeleteTemplateById() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/templates/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
