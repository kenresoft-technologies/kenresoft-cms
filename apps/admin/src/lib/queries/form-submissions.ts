import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { FormSubmission, FormSubmissionStatus } from '@/lib/types';

export function useFormSubmissions(formId: string) {
  return useQuery({
    queryKey: ['form-submissions', formId],
    queryFn: () => apiClient.get<FormSubmission[]>(`/api/v1/admin/forms/${formId}/submissions`),
    enabled: Boolean(formId),
  });
}

// Matches mediaFileUrl's pattern (lib/queries/media.ts) — admin-gated, for a download link
// inside the authenticated admin UI only.
export function submissionAttachmentUrl(formId: string, submissionId: string, fieldName: string): string {
  return `${import.meta.env.VITE_API_URL}/api/v1/admin/forms/${formId}/submissions/${submissionId}/files/${fieldName}`;
}

export function useUpdateFormSubmissionStatus(formId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: FormSubmissionStatus }) =>
      apiClient.patch<FormSubmission>(`/api/v1/admin/forms/${formId}/submissions/${id}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['form-submissions', formId] });
    },
  });
}
