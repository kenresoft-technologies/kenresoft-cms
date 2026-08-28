import { z } from 'zod';

export const cachePurgeResultSchema = z.object({
  entriesPurged: z.number().int(),
  mediaPurged: z.number().int(),
});

export type CachePurgeResult = z.infer<typeof cachePurgeResultSchema>;
