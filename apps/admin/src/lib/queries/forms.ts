import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { Form } from '@/lib/types';

const formsKey = ['forms'] as const;

export function useForms() {
  return useQuery({
    queryKey: formsKey,
    queryFn: () => apiClient.get<Form[]>('/api/v1/admin/forms'),
  });
}

export function useForm(formId: string) {
  return useQuery({
    queryKey: ['forms', 'by-id', formId],
    queryFn: () => apiClient.get<Form>(`/api/v1/admin/forms/${formId}`),
    enabled: Boolean(formId),
  });
}

export function useCreateForm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; slug: string }) => apiClient.post<Form>('/api/v1/admin/forms', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formsKey });
    },
  });
}
