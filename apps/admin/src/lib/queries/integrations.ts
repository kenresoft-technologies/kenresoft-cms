import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface IntegrationsStatus {
  pixabay: { configured: boolean; source: 'env' | 'admin' | null };
}

const integrationsKey = ['integrations'] as const;

// Admin-only endpoint; callers gate on role, and it never returns a key — only whether one exists.
export function useIntegrationsStatus(enabled = true) {
  return useQuery({
    queryKey: integrationsKey,
    queryFn: () => apiClient.get<IntegrationsStatus>('/api/v1/admin/integrations'),
    enabled,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: integrationsKey });
    // The picker's Pixabay tab caches "not configured" results.
    void queryClient.invalidateQueries({ queryKey: ['pixabay-search'] });
  };
}

export function useSavePixabayKey() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (apiKey: string) => apiClient.put<IntegrationsStatus>('/api/v1/admin/integrations/pixabay', { apiKey }),
    onSuccess: invalidate,
  });
}

export function useRemovePixabayKey() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => apiClient.delete<IntegrationsStatus>('/api/v1/admin/integrations/pixabay'),
    onSuccess: invalidate,
  });
}
