import { z } from 'zod';

import { slugSchema } from './common';
import { routePatternSchema } from './routing';

export const contentTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  // Phase 2 (docs/SITE_BUILDER.md): e.g. "/blog/{slug}" — null means this content type has no
  // frontend route of its own, exactly like every content type before this feature existed.
  routePattern: routePatternSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createContentTypeSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  description: z.string().max(2000).nullable().optional(),
  routePattern: routePatternSchema.nullable().optional(),
});

export const updateContentTypeSchema = createContentTypeSchema.partial();

export type ContentType = z.infer<typeof contentTypeSchema>;
export type CreateContentTypeInput = z.infer<typeof createContentTypeSchema>;
export type UpdateContentTypeInput = z.infer<typeof updateContentTypeSchema>;
