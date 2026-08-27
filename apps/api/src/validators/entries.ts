import { z } from 'zod';
import { ENTRY_STATUSES } from '@kenresoft/contracts';

import { slugSchema } from './common';

// z.null() must come before z.coerce.date() — coercion treats null as epoch (new Date(null))
// rather than failing, so checking the exact-null case first is what makes "clear the
// schedule" (explicit null) behave differently from "leave it alone" (omitted).
const publishAtSchema = z.union([z.null(), z.coerce.date()]);

export const createEntrySchema = z.object({
  slug: slugSchema,
  status: z.enum(ENTRY_STATUSES).optional().default('draft'),
  data: z.record(z.string(), z.unknown()),
  publishAt: publishAtSchema.optional(),
});

export const updateEntrySchema = z.object({
  slug: slugSchema.optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  publishAt: publishAtSchema.optional(),
});
