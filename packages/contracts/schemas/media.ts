import { z } from 'zod';

// Raster image types accepted for V1 (§14) — verified against the file's actual bytes at
// upload time, not the client-supplied Content-Type (§9: never trust browser-provided MIME
// types alone). Other media (PDF/doc, etc.) is future work.
export const MEDIA_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

export const mediaSchema = z.object({
  id: z.string(),
  key: z.string(),
  filename: z.string(),
  contentType: z.enum(MEDIA_CONTENT_TYPES),
  size: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  altText: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// No create-request schema — upload is multipart/form-data (a file plus an optional altText
// field), validated by sniffing the file's actual bytes rather than a declared MIME type, so
// it doesn't fit a static JSON body schema. altTextSchema alone is still useful standalone
// for the one plain-string field the route does validate with Zod.
export const altTextSchema = z.string().max(500).optional();

export type Media = z.infer<typeof mediaSchema>;
