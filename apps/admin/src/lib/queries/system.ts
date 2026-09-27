import { useQuery } from '@tanstack/react-query';
import type { SystemVersion } from '@kenresoft-cms/contracts';

import { apiClient } from '@/lib/api-client';

// The running CMS version and the latest release (GET /api/v1/admin/system/version). Admin-only
// on the server, so callers pass `enabled: false` for anyone else rather than firing a 403. The
// server caches GitHub's answer for hours; an hour here is plenty to avoid refetching it on every
// page change.
export function useSystemVersion({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: ['system', 'version'],
    queryFn: () => apiClient.get<SystemVersion>('/api/v1/admin/system/version'),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}
