import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { FormSubmission, FormSubmissionStatus, FormSubmissionWithForm } from '@/lib/types';

// Backs the unified admin Submissions view — every submission across every form, mirroring
// queries/all-entries.ts's useAllEntries.
export function useAllSubmissions() {
  return useQuery({
    queryKey: ['submissions', 'all'],
    queryFn: () => apiClient.get<FormSubmissionWithForm[]>('/api/v1/admin/submissions'),
  });
}

// Status updates still go through the per-form endpoint (each row already carries its own
// formId from the join) — there's no flat /admin/submissions/:id route, unlike entries, since
// nothing else needed one yet. Invalidates broadly, matching useUpdateEntryStatusGlobal: the
// global list, the row's own per-form list, and any other open per-form list.
export function useUpdateSubmissionStatusGlobal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ formId, id, status }: { formId: string; id: string; status: FormSubmissionStatus }) =>
      apiClient.patch<FormSubmission>(`/api/v1/admin/forms/${formId}/submissions/${id}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['submissions'] });
      void queryClient.invalidateQueries({ queryKey: ['form-submissions'] });
    },
  });
}
