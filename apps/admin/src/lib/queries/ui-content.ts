import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { UiContentItem, UiContentType } from '@/lib/types';

const typesKey = ['ui-content-types'] as const;
const itemsKey = (typeId: string) => ['ui-content-types', typeId, 'items'] as const;

export function useUiContentTypes() {
  return useQuery({
    queryKey: typesKey,
    queryFn: () => apiClient.get<UiContentType[]>('/api/v1/admin/ui-content/types'),
  });
}

export function useUiContentType(typeId: string | undefined) {
  return useQuery({
    queryKey: [...typesKey, typeId],
    queryFn: async () => {
      const types = await apiClient.get<UiContentType[]>('/api/v1/admin/ui-content/types');
      return types.find((t) => t.id === typeId) ?? null;
    },
    enabled: typeId !== undefined,
  });
}

export interface UiContentTypeInput {
  name: string;
  slug: string;
  fields?: { name: string; label: string; fieldType: string; required: boolean; config: Record<string, unknown> }[];
}

export function useCreateUiContentType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UiContentTypeInput) => apiClient.post<UiContentType>('/api/v1/admin/ui-content/types', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: typesKey });
    },
  });
}

export function useUpdateUiContentType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<UiContentTypeInput> & { id: string }) =>
      apiClient.patch<UiContentType>(`/api/v1/admin/ui-content/types/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: typesKey });
    },
  });
}

export function useDeleteUiContentType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/ui-content/types/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: typesKey });
    },
  });
}

export function useUiContentItems(typeId: string | undefined) {
  return useQuery({
    queryKey: itemsKey(typeId ?? ''),
    queryFn: () => apiClient.get<UiContentItem[]>(`/api/v1/admin/ui-content/types/${typeId}/items`),
    enabled: typeId !== undefined,
  });
}

export interface UiContentItemInput {
  slug: string;
  data: Record<string, unknown>;
  enabled?: boolean;
}

export function useCreateUiContentItem(typeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UiContentItemInput) =>
      apiClient.post<UiContentItem>(`/api/v1/admin/ui-content/types/${typeId}/items`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: itemsKey(typeId) });
    },
  });
}

export function useUpdateUiContentItem(typeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<UiContentItemInput> & { id: string }) =>
      apiClient.patch<UiContentItem>(`/api/v1/admin/ui-content/types/${typeId}/items/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: itemsKey(typeId) });
    },
  });
}

export function useDeleteUiContentItem(typeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/ui-content/types/${typeId}/items/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: itemsKey(typeId) });
    },
  });
}
