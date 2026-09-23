import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { EmailTemplate } from '@/lib/types';

const templatesKey = ['email-templates'] as const;

export function useEmailTemplates() {
  return useQuery({
    queryKey: templatesKey,
    queryFn: () => apiClient.get<EmailTemplate[]>('/api/v1/admin/email-templates'),
  });
}

export interface UpdateEmailTemplateInput {
  subject?: string;
  bodyHtml?: string;
  plainText?: string | null;
  enabled?: boolean;
}

export function useUpdateEmailTemplate(key: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateEmailTemplateInput) =>
      apiClient.patch<EmailTemplate>(`/api/v1/admin/email-templates/${key}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: templatesKey });
    },
  });
}

export function useRestoreEmailTemplateDefault(key: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.post<EmailTemplate>(`/api/v1/admin/email-templates/${key}/restore-default`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: templatesKey });
    },
  });
}

export interface EmailTemplatePreviewResult {
  subject: string;
  html: string;
  text: string;
}

export function usePreviewEmailTemplate(key: string) {
  return useMutation({
    mutationFn: (input: { subject: string; bodyHtml: string; plainText?: string | null }) =>
      apiClient.post<EmailTemplatePreviewResult>(`/api/v1/admin/email-templates/${key}/preview`, input),
  });
}

export function useSendTestEmailTemplate(key: string) {
  return useMutation({
    mutationFn: (to: string) =>
      apiClient.post<{ sent: boolean }>(`/api/v1/admin/email-templates/${key}/send-test`, { to }),
  });
}
