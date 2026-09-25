import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { EmailDesign, EmailTemplate, EmailTemplateContent } from '@/lib/types';

const templatesKey = ['email-templates'] as const;
const designsKey = ['email-templates', 'designs'] as const;

export function useEmailTemplates() {
  return useQuery({
    queryKey: templatesKey,
    queryFn: () => apiClient.get<EmailTemplate[]>('/api/v1/admin/email-templates'),
  });
}

// Static registry metadata — cached indefinitely for this session; the design list can only
// change with a CMS code update, never at runtime.
export function useEmailDesigns() {
  return useQuery({
    queryKey: designsKey,
    queryFn: () => apiClient.get<EmailDesign[]>('/api/v1/admin/email-templates/designs'),
    staleTime: Infinity,
  });
}

export interface UpdateEmailTemplateInput {
  subject?: string;
  mode?: 'standard' | 'developer';
  content?: EmailTemplateContent;
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

export type PreviewEmailTemplateInput =
  | { mode: 'standard'; subject: string; content: EmailTemplateContent; plainText?: string | null; designId?: string }
  | { mode: 'developer'; subject: string; bodyHtml: string; plainText?: string | null };

export function usePreviewEmailTemplate(key: string) {
  return useMutation({
    mutationFn: (input: PreviewEmailTemplateInput) =>
      apiClient.post<EmailTemplatePreviewResult>(`/api/v1/admin/email-templates/${key}/preview`, input),
  });
}

export function useSendTestEmailTemplate(key: string) {
  return useMutation({
    mutationFn: (to: string) =>
      apiClient.post<{ sent: boolean }>(`/api/v1/admin/email-templates/${key}/send-test`, { to }),
  });
}
