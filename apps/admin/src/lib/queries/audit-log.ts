import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { AuditLogEntryWithActor } from '@/lib/types';

export interface AuditLogFilters {
  actorUserId?: string | undefined;
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

function buildQuery(filters: AuditLogFilters): string {
  const params = new URLSearchParams();
  if (filters.actorUserId) params.set('actorUserId', filters.actorUserId);
  if (filters.action) params.set('action', filters.action);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('limit', '200');
  return params.toString();
}

export function useAuditLog(filters: AuditLogFilters) {
  return useQuery({
    queryKey: ['audit-log', filters],
    queryFn: () => apiClient.get<AuditLogEntryWithActor[]>(`/api/v1/admin/audit-log?${buildQuery(filters)}`),
  });
}
