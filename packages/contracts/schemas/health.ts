import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
