import { z } from 'zod';

import { slugSchema } from './common';

export const formSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createFormSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
});

export const updateFormSchema = createFormSchema.partial();

export type Form = z.infer<typeof formSchema>;
export type CreateFormInput = z.infer<typeof createFormSchema>;
export type UpdateFormInput = z.infer<typeof updateFormSchema>;
