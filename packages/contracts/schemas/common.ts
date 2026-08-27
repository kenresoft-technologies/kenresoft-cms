import { z } from 'zod';

export const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase alphanumeric, hyphen-separated');

// Shared shape for routes with a single :id path param — createRoute()'s `request.params`.
export const idParamSchema = z.object({
  id: z.string().min(1),
});
