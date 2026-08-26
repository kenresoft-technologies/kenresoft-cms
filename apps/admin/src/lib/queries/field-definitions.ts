import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { FieldDefinition, FieldType } from '@/lib/types';

export function useFieldDefinitions(contentTypeId: string) {
  return useQuery({
    queryKey: ['field-definitions', contentTypeId],
    queryFn: () =>
      apiClient.get<FieldDefinition[]>(`/api/v1/admin/content-types/${contentTypeId}/fields`),
    enabled: Boolean(contentTypeId),
  });
}

export function useCreateFieldDefinition(contentTypeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; label: string; fieldType: FieldType; required: boolean }) =>
      apiClient.post<FieldDefinition>(
        `/api/v1/admin/content-types/${contentTypeId}/fields`,
        input,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['field-definitions', contentTypeId] });
    },
  });
}
