import { z } from 'zod';

import { slugSchema } from './common';

export const createContentTypeSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(200),
  slug: slugSchema,
  description: z.string().max(2000).nullable().optional(),
});
