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

export type Media = z.infer<typeof mediaSchema>;
