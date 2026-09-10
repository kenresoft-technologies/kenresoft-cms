import { useMutation } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface CachePurgeJobStatus {
  id: string;
  totalItems: number;
  processedItems: number;
  done: boolean;
}

// Each call processes one bounded batch of the purge queue and returns its progress — `done:
// false` means there's more to do, whether because the catalog is larger than one batch or
// because an earlier job was already mid-flight. Calling this again (immediately, or via the
// 5-minute Cron Trigger in the background) continues the same job rather than starting over.
export function usePurgeCache() {
  return useMutation({
    mutationFn: () => apiClient.post<CachePurgeJobStatus>('/api/v1/admin/cache/purge', {}),
  });
}
