import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { GlobalVariable } from '@/lib/types';

const globalVariablesKey = ['global-variables'] as const;

export function useGlobalVariables() {
  return useQuery({
    queryKey: globalVariablesKey,
    queryFn: () => apiClient.get<GlobalVariable[]>('/api/v1/admin/global-variables'),
  });
}

export function useCreateGlobalVariable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { key: string; value: string }) =>
      apiClient.post<GlobalVariable>('/api/v1/admin/global-variables', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalVariablesKey });
    },
  });
}

export function useUpdateGlobalVariable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      apiClient.patch<GlobalVariable>(`/api/v1/admin/global-variables/${id}`, { value }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalVariablesKey });
    },
  });
}

export function useDeleteGlobalVariable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/global-variables/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalVariablesKey });
    },
  });
}
