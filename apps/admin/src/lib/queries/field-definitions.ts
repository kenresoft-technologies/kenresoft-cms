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
    mutationFn: (input: {
      name: string;
      label: string;
      fieldType: FieldType;
      required: boolean;
      config?: Record<string, unknown> | null;
    }) =>
      apiClient.post<FieldDefinition>(
        `/api/v1/admin/content-types/${contentTypeId}/fields`,
        input,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['field-definitions', contentTypeId] });
    },
  });
}

export function useUpdateFieldDefinition(contentTypeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      fieldId,
      ...input
    }: {
      fieldId: string;
      name?: string;
      label?: string;
      fieldType?: FieldType;
      required?: boolean;
      config?: Record<string, unknown> | null;
    }) =>
      apiClient.patch<FieldDefinition>(
        `/api/v1/admin/content-types/${contentTypeId}/fields/${fieldId}`,
        input,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['field-definitions', contentTypeId] });
    },
  });
}

export function useDeleteFieldDefinition(contentTypeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fieldId: string) =>
      apiClient.delete<void>(`/api/v1/admin/content-types/${contentTypeId}/fields/${fieldId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['field-definitions', contentTypeId] });
    },
  });
}

export function useReorderFieldDefinitions(contentTypeId: string) {
  const queryClient = useQueryClient();
  const queryKey = ['field-definitions', contentTypeId];

  return useMutation({
    mutationFn: (fieldIds: string[]) =>
      apiClient.patch<FieldDefinition[]>(
        `/api/v1/admin/content-types/${contentTypeId}/fields/reorder`,
        { fieldIds },
      ),
    // Optimistic: dragging should feel instant rather than waiting on a round-trip. Rolled
    // back in onError if the server rejects the reorder (e.g. a stale field list).
    onMutate: async (fieldIds) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FieldDefinition[]>(queryKey);
      if (previous) {
        const byId = new Map(previous.map((field) => [field.id, field]));
        const reordered = fieldIds
          .map((id, index) => {
            const field = byId.get(id);
            return field ? { ...field, sortOrder: index } : undefined;
          })
          .filter((field): field is FieldDefinition => field !== undefined);
        queryClient.setQueryData(queryKey, reordered);
      }
      return { previous };
    },
    onError: (_err, _fieldIds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
