import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { PluginSummary } from '@/lib/types';

const pluginsKey = ['plugins'] as const;

// Readable by any authenticated role (apps/api/src/routes/admin/plugins.ts) — the sidebar and
// command palette both need this for every role, not just admin, to know whether a plugin's nav
// entry should render at all.
export function usePlugins() {
  return useQuery({
    queryKey: pluginsKey,
    queryFn: () => apiClient.get<PluginSummary[]>('/api/v1/admin/plugins'),
  });
}

export function useUpdatePluginEnablement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiClient.patch<PluginSummary>(`/api/v1/admin/plugins/${id}`, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pluginsKey });
    },
  });
}
