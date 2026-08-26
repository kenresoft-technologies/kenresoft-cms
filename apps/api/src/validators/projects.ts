import { z } from 'zod';

import { slugSchema } from './common';

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
});
