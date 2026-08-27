import { z } from 'zod';

import { slugSchema } from './common';
import { ENTRY_STATUSES } from './enums';

export const entrySchema = z.object({
  id: z.string(),
  contentTypeId: z.string(),
  slug: z.string(),
  status: z.enum(ENTRY_STATUSES),
  data: z.record(z.string(), z.unknown()),
  publishAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// z.null() must come before z.coerce.date() — coercion treats null as epoch (new Date(null))
// rather than failing, so checking the exact-null case first is what makes "clear the
// schedule" (explicit null) behave differently from "leave it alone" (omitted).
const publishAtInputSchema = z.union([z.null(), z.coerce.date()]);

export const createEntrySchema = z.object({
  slug: slugSchema,
  status: z.enum(ENTRY_STATUSES).optional().default('draft'),
  data: z.record(z.string(), z.unknown()),
  publishAt: publishAtInputSchema.optional(),
});

export const updateEntrySchema = z.object({
  slug: slugSchema.optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  publishAt: publishAtInputSchema.optional(),
});

export type Entry = z.infer<typeof entrySchema>;
export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;

// Admin-only — backs the unified "all entries" listing across every content type. Deliberately
// NOT folded into entrySchema: entrySchema is reused verbatim by the public, unauthenticated
// content API (apps/api/src/routes/public/content.ts), and this shape's authorName/authorEmail
// would leak an internal user's identity to anonymous visitors if it were.
export const entryWithContentTypeSchema = entrySchema.extend({
  contentTypeName: z.string(),
  contentTypeSlug: z.string(),
  authorName: z.string().nullable(),
  authorEmail: z.string().nullable(),
});

export type EntryWithContentType = z.infer<typeof entryWithContentTypeSchema>;
