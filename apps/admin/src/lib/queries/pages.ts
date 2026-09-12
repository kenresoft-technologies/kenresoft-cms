import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { BlockInstance, EntryStatus, Page, PageRevision, PageSeo } from '@/lib/types';

type PageWriteInput = {
  route?: string;
  title?: string;
  status?: EntryStatus;
  templateId?: string | undefined;
  blocks?: BlockInstance[];
  seo?: PageSeo | null;
  publishAt?: string | null;
};

export function usePages() {
  return useQuery({
    queryKey: ['pages'],
    queryFn: () => apiClient.get<Page[]>('/api/v1/admin/pages'),
  });
}

export function usePage(id: string) {
  return useQuery({
    queryKey: ['pages', 'by-id', id],
    queryFn: () => apiClient.get<Page>(`/api/v1/admin/pages/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreatePage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PageWriteInput) => apiClient.post<Page>('/api/v1/admin/pages', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function useUpdatePage(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PageWriteInput) => apiClient.patch<Page>(`/api/v1/admin/pages/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pages'] });
      void queryClient.invalidateQueries({ queryKey: ['pages', 'by-id', id] });
    },
  });
}

export function useDeletePageById() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/pages/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function usePageRevisions(pageId: string) {
  return useQuery({
    queryKey: ['pages', 'by-id', pageId, 'revisions'],
    queryFn: () => apiClient.get<PageRevision[]>(`/api/v1/admin/pages/${pageId}/revisions`),
    enabled: Boolean(pageId),
  });
}

export function useRestorePageRevision(pageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (revisionId: string) =>
      apiClient.post<Page>(`/api/v1/admin/pages/${pageId}/revisions/${revisionId}/restore`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pages'] });
      void queryClient.invalidateQueries({ queryKey: ['pages', 'by-id', pageId] });
    },
  });
}
