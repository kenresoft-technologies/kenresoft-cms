import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  ContactSettingsData,
  FooterSettingsData,
  GeneralSettingsData,
  LegacyMigrationReport,
  NavigationSettingsData,
  SeoSettingsData,
  SocialSettingsData,
  StructuredSettingsModule,
  StructuredSettingsRow,
} from '@/lib/types';

// Keyed per module — editing one module never invalidates/refetches another's already-loaded
// data (each Settings section only ever touches its own module).
function structuredSettingsKey(module: StructuredSettingsModule) {
  return ['structured-settings', module] as const;
}

type DataByModule = {
  general: GeneralSettingsData;
  contact: ContactSettingsData;
  social: SocialSettingsData;
  navigation: NavigationSettingsData;
  footer: FooterSettingsData;
  seo: SeoSettingsData;
};

export function useStructuredSettings<M extends StructuredSettingsModule>(module: M) {
  return useQuery({
    queryKey: structuredSettingsKey(module),
    queryFn: () => apiClient.get<StructuredSettingsRow | null>(`/api/v1/admin/structured-settings/${module}`),
  });
}

export function useUpdateStructuredSettings<M extends StructuredSettingsModule>(module: M) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: DataByModule[M]) =>
      apiClient.put<StructuredSettingsRow>(`/api/v1/admin/structured-settings/${module}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: structuredSettingsKey(module) });
    },
  });
}

export function useMigrateLegacySettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.post<LegacyMigrationReport>('/api/v1/admin/structured-settings/migrate-legacy', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['structured-settings'] });
    },
  });
}
