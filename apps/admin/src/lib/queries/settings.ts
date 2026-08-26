import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { Settings } from '@/lib/types';

const settingsKey = ['settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => apiClient.get<Settings | null>('/api/v1/admin/settings'),
  });
}

export type SettingsInput = {
  name: string;
  contactEmail: string | null;
  socialLinks: Record<string, string> | null;
  corsOrigin: string | null;
  featureFlags: Record<string, boolean> | null;
};

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SettingsInput) => apiClient.put<Settings>('/api/v1/admin/settings', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKey });
    },
  });
}
