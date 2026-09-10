import { z } from 'zod';

// A purge job may need more than one batch to finish (see apps/api/src/lib/cache-purge.ts) —
// `done: false` means the caller should expect to call the purge route again (or wait for the
// next scheduled tick) to make further progress on the same job.
export const cachePurgeJobStatusSchema = z.object({
  id: z.string(),
  totalItems: z.number().int(),
  processedItems: z.number().int(),
  done: z.boolean(),
});

export type CachePurgeJobStatus = z.infer<typeof cachePurgeJobStatusSchema>;
