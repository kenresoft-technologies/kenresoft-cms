import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { Media } from '@/lib/types';

const mediaKey = ['media'] as const;

// `enabled` defaults to true (every existing caller keeps fetching on mount as before) — added
// so AvatarPickerDialog can pass `open` and only fetch once its picker is actually opened,
// instead of every ProfilePage visit eagerly pulling the entire media library in the background.
export function useMediaList(enabled = true) {
  return useQuery({
    queryKey: mediaKey,
    queryFn: () => apiClient.get<Media[]>('/api/v1/admin/media'),
    enabled,
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
// for rendering thumbnails inside the authenticated admin UI. Matches @kenresoft-cms/astro's own
// media.url() (integrations/astro/src/index.ts).
export function publicMediaFileUrl(id: string): string {
  return `${import.meta.env.VITE_API_URL}/api/v1/public/media/${id}/file`;
}
