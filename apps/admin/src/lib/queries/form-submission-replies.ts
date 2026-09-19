import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { buildComposeFormData, type ComposedEmail } from '@/lib/queries/email';
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
    mutationFn: (input: ComposedEmail) =>
      apiClient.upload<FormSubmissionReply>(
        `/api/v1/admin/forms/${formId}/submissions/${submissionId}/replies`,
        buildComposeFormData(input),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['form-submission-replies', formId, submissionId] });
    },
  });
}
