import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { FormSubmissionReply } from '@/lib/types';

export function useSubmissionReplies(formId: string, submissionId: string) {
  return useQuery({
    queryKey: ['form-submission-replies', formId, submissionId],
    queryFn: () =>
      apiClient.get<FormSubmissionReply[]>(`/api/v1/admin/forms/${formId}/submissions/${submissionId}/replies`),
    enabled: Boolean(formId) && Boolean(submissionId),
  });
}

export function useSendSubmissionReply(formId: string, submissionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { to: string; subject: string; bodyHtml: string }) =>
      apiClient.post<FormSubmissionReply>(
        `/api/v1/admin/forms/${formId}/submissions/${submissionId}/replies`,
        input,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['form-submission-replies', formId, submissionId] });
    },
  });
}
