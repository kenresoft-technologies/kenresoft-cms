import { z } from 'zod';

import { MEDIA_CONTENT_TYPES } from './enums';

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

// The subset of Media that's safe to expose from the public API (GET /api/v1/public/media/:id)
// alongside the already-public file bytes (.../media/:id/file) — no key (the internal R2
// object path), filename, or timestamps, since those describe internal storage rather than
// how to render the file. altText/width/height close a real gap for public consumers (e.g.
// @kenresoft-cms/astro): the file route alone gives no way to set an <img alt> or avoid layout
// shift while the image loads.
export const publicMediaSchema = z.object({
  altText: z.string().nullable(),
  contentType: z.enum(MEDIA_CONTENT_TYPES),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

export type Media = z.infer<typeof mediaSchema>;
export type PublicMedia = z.infer<typeof publicMediaSchema>;
