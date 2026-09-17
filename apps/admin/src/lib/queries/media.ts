import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { Media, MediaFolder } from '@/lib/types';

const mediaKey = ['media'] as const;
const mediaFoldersKey = ['media-folders'] as const;

// `folderId` follows the API's own three-state convention: undefined = every item, 'unfiled' =
// only items with no folder, a real id = only that folder — so the query key must include it or
// switching folders in the UI would silently reuse another folder's cached list.
export function useMediaList(options?: { enabled?: boolean; folderId?: string | undefined }) {
  const { enabled = true, folderId } = options ?? {};
  return useQuery({
    queryKey: [...mediaKey, folderId ?? 'all'],
    queryFn: () =>
      apiClient.get<Media[]>(`/api/v1/admin/media${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`),
    enabled,
  });
}

export function useMediaFolders() {
  return useQuery({
    queryKey: mediaFoldersKey,
    queryFn: () => apiClient.get<MediaFolder[]>('/api/v1/admin/media-folders'),
  });
}

export function useCreateMediaFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; slug: string; parentId?: string | null }) =>
      apiClient.post<MediaFolder>('/api/v1/admin/media-folders', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaFoldersKey });
    },
  });
}

export function useUpdateMediaFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; slug?: string; parentId?: string | null }) =>
      apiClient.patch<MediaFolder>(`/api/v1/admin/media-folders/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaFoldersKey });
    },
  });
}

export function useDeleteMediaFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/api/v1/admin/media-folders/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaFoldersKey });
      void queryClient.invalidateQueries({ queryKey: mediaKey });
    },
  });
}

export function useMoveMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { mediaIds: string[]; folderId: string | null }) =>
      apiClient.post<{ moved: number }>('/api/v1/admin/media/move', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaKey });
    },
  });
}

export function useUploadMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { file: File; altText?: string | undefined; folderId?: string | undefined }) => {
      const formData = new FormData();
      formData.set('file', input.file);
      if (input.altText) formData.set('altText', input.altText);
      if (input.folderId) formData.set('folderId', input.folderId);
      return apiClient.upload<Media>('/api/v1/admin/media', formData);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaKey });
    },
  });
}

export function useUpdateMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; filename?: string; altText?: string | null }) =>
      apiClient.patch<Media>(`/api/v1/admin/media/${id}`, input),
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
