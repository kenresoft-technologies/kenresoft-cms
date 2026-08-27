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
