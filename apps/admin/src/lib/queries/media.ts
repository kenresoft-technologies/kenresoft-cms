import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { Media } from '@/lib/types';

const mediaKey = ['media'] as const;

export function useMediaList() {
  return useQuery({
    queryKey: mediaKey,
    queryFn: () => apiClient.get<Media[]>('/api/v1/admin/media'),
  });
}

export function useUploadMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { file: File; altText?: string | undefined }) => {
      const formData = new FormData();
      formData.set('file', input.file);
      if (input.altText) formData.set('altText', input.altText);
      return apiClient.upload<Media>('/api/v1/admin/media', formData);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaKey });
    },
  });
}

export function useDeleteMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/media/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaKey });
    },
  });
}

export function mediaFileUrl(id: string): string {
  return `${import.meta.env.VITE_API_URL}/api/v1/admin/media/${id}/file`;
}

// The route a real frontend consumer actually uses — admin-gated mediaFileUrl above is only
// for rendering thumbnails inside the authenticated admin UI. Matches @kenresoft/astro's own
// media.url() (integrations/astro/src/index.ts).
export function publicMediaFileUrl(id: string): string {
  return `${import.meta.env.VITE_API_URL}/api/v1/public/media/${id}/file`;
}
