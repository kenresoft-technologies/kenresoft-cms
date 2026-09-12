import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { BlockType, ReusableBlock } from '@/lib/types';

type ReusableBlockWriteInput = {
  name?: string;
  type?: BlockType;
  config?: Record<string, unknown>;
};

export function useReusableBlocks() {
  return useQuery({
    queryKey: ['reusable-blocks'],
    queryFn: () => apiClient.get<ReusableBlock[]>('/api/v1/admin/reusable-blocks'),
  });
}

export function useCreateReusableBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ReusableBlockWriteInput) =>
      apiClient.post<ReusableBlock>('/api/v1/admin/reusable-blocks', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reusable-blocks'] });
    },
  });
}

export function useUpdateReusableBlock(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ReusableBlockWriteInput) =>
      apiClient.patch<ReusableBlock>(`/api/v1/admin/reusable-blocks/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reusable-blocks'] });
    },
  });
}

export function useDeleteReusableBlockById() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/reusable-blocks/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reusable-blocks'] });
    },
  });
}
