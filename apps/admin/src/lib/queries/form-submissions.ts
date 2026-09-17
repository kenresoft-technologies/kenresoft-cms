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

// "Preview & Test" — submits a real test entry through the same pipeline a public submission
// uses (server-side: submit-form.ts's shared submitForm()), flagged isTest so it's excluded
// from any future count/export by default and badged in the inbox rather than hidden. Takes a
// FormData body directly (not a typed input object) since the request shape is dynamic per
// form's own fields, the same reason the public submission route has no fixed request schema.
export function useTestFormSubmission(formId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (formData: FormData) =>
      apiClient.upload<FormSubmission>(`/api/v1/admin/forms/${formId}/test-submissions`, formData),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['form-submissions', formId] });
      void queryClient.invalidateQueries({ queryKey: ['submissions'] });
    },
  });
}

export function useDeleteFormSubmission(formId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/admin/forms/${formId}/submissions/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['form-submissions', formId] });
      void queryClient.invalidateQueries({ queryKey: ['submissions'] });
    },
  });
}
