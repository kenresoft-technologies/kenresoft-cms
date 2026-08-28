import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { FormField, FormFieldType } from '@/lib/types';

export function useFormFields(formId: string) {
  return useQuery({
    queryKey: ['form-fields', formId],
    queryFn: () => apiClient.get<FormField[]>(`/api/v1/admin/forms/${formId}/fields`),
    enabled: Boolean(formId),
  });
}

export function useCreateFormField(formId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      name: string;
      label: string;
      fieldType: FormFieldType;
      required: boolean;
      config?: Record<string, unknown> | null;
    }) => apiClient.post<FormField>(`/api/v1/admin/forms/${formId}/fields`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['form-fields', formId] });
    },
  });
}

export function useUpdateFormField(formId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      fieldId,
      ...input
    }: {
      fieldId: string;
      name?: string;
      label?: string;
      fieldType?: FormFieldType;
      required?: boolean;
      config?: Record<string, unknown> | null;
    }) => apiClient.patch<FormField>(`/api/v1/admin/forms/${formId}/fields/${fieldId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['form-fields', formId] });
    },
  });
}

export function useDeleteFormField(formId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fieldId: string) => apiClient.delete<void>(`/api/v1/admin/forms/${formId}/fields/${fieldId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['form-fields', formId] });
    },
  });
}
