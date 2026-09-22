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

export function useImportExternalMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      source: 'picsum';
      width: number;
      height: number;
      pictureId?: string | undefined;
      seed?: string | undefined;
      grayscale?: boolean | undefined;
      blur?: number | undefined;
      altText?: string | undefined;
      folderId?: string | undefined;
    }) => apiClient.post<Media>('/api/v1/admin/media/import-external', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaKey });
    },
  });
}

export interface PicsumPhoto {
  id: string;
  author: string;
  width: number;
  height: number;
}

// Picsum's own public catalog (picsum.photos/v2/list) — fetched directly from the browser, not
// through this deployment's API, since it's read-only third-party metadata (not user data) and
// Picsum serves it with a permissive `Access-Control-Allow-Origin: *`. Only the actual chosen
// photo is later downloaded server-side and stored in R2 (useImportExternalMedia), so nothing
// about this deployment ever depends on Picsum staying up beyond browse time.
export function usePicsumCatalog(page: number) {
  return useQuery({
    queryKey: ['picsum-catalog', page],
    queryFn: async () => {
      const res = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=30`);
      if (!res.ok) throw new Error('Failed to reach Picsum');
      return (await res.json()) as PicsumPhoto[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function picsumThumbnailUrl(id: string, size = 300): string {
  return `https://picsum.photos/id/${id}/${size}/${size}`;
}

// Picsum's seed URLs are deterministic and need no catalog lookup at all — typing a word and
// requesting this URL directly is Picsum's own "search" of sorts (the same photo every time for
// that exact word), which is why this needs no network round trip before previewing it.
export function picsumSeedUrl(seed: string, width = 800, height = 600): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;
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
