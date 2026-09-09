import { useMutation } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface CachePurgeResult {
  entriesPurged: number;
  mediaPurged: number;
}

export function usePurgeCache() {
  return useMutation({
    mutationFn: () => apiClient.post<CachePurgeResult>('/api/v1/admin/cache/purge', {}),
  });
}
