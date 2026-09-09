import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { DashboardStats } from '@/lib/types';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiClient.get<DashboardStats>('/api/v1/admin/dashboard'),
  });
}
