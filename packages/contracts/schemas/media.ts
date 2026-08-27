// Raster image types accepted for V1 (§14) — verified against the file's actual bytes at
// upload time, not the client-supplied Content-Type (§9: never trust browser-provided MIME
// types alone). Other media (PDF/doc, etc.) is future work.
export const MEDIA_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];
