import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { Project } from '@/lib/types';

const projectsKey = ['projects'] as const;

export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: () => apiClient.get<Project[]>('/api/v1/admin/projects'),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: [...projectsKey, id],
    queryFn: () => apiClient.get<Project>(`/api/v1/admin/projects/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      apiClient.post<Project>('/api/v1/admin/projects', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
}
