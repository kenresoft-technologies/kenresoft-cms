import { useMutation, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export interface EmailLimits {
  configured: boolean;
  maxTotalBytes: number;
  maxFiles: number;
}

export function useEmailLimits() {
  return useQuery({
    queryKey: ['email-limits'],
    queryFn: () => apiClient.get<EmailLimits>('/api/v1/admin/email/limits'),
  });
}

export interface AttachmentState {
  files: File[];
  mediaIds: string[];
}

export const emptyAttachments: AttachmentState = { files: [], mediaIds: [] };

export interface ComposedEmail {
  to: string;
  subject: string;
  bodyHtml: string;
  files: File[];
  mediaIds: string[];
  // 'Design HTML' mode (admin/owner only): send the pasted template with its layout preserved.
  designHtml?: boolean;
  // Optional; the server defaults Reply-To to the configured Email sender address (else the staff member's own).
  replyTo?: string;
}

// One multipart shape for every admin-composed email (this page and submission replies) —
// the server does all attachment validation and provider-specific encoding.
export function buildComposeFormData({
  to,
  subject,
  bodyHtml,
  files,
  mediaIds,
  designHtml,
  replyTo,
}: ComposedEmail): FormData {
  const form = new FormData();
  form.append('to', to);
  if (replyTo) form.append('replyTo', replyTo);
  form.append('subject', subject);
  form.append('bodyHtml', bodyHtml);
  if (designHtml) form.append('designHtml', 'true');
  for (const file of files) form.append('files', file);
  for (const id of mediaIds) form.append('mediaIds', id);
  return form;
}

export function useSendEmail() {
  return useMutation({
    mutationFn: (input: ComposedEmail) =>
      apiClient.upload<{ from: string | null }>('/api/v1/admin/email/send', buildComposeFormData(input)),
  });
}
