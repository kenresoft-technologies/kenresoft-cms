import { z } from 'zod';
import { ENTRY_STATUSES } from '@kenresoft/database';

import { slugSchema } from './common';

export const createEntrySchema = z.object({
  slug: slugSchema,
  status: z.enum(ENTRY_STATUSES).optional().default('draft'),
  data: z.record(z.string(), z.unknown()),
});

export const updateEntrySchema = z.object({
  slug: slugSchema.optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
