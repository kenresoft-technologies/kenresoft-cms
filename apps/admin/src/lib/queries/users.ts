import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { AdminUser, UserRole } from '@/lib/types';

const usersKey = ['users'] as const;

export function useUsers() {
  return useQuery({
    queryKey: usersKey,
    queryFn: () => apiClient.get<AdminUser[]>('/api/v1/admin/users'),
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      apiClient.patch<AdminUser>(`/api/v1/admin/users/${id}/role`, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey });
    },
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; email: string }) =>
      apiClient.post<{ user: AdminUser; temporaryPassword: string }>('/api/v1/admin/users', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/users/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey });
    },
  });
}
