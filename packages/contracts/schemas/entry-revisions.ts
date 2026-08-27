import { z } from 'zod';

import { ENTRY_STATUSES } from './entries';

// Read/restore only — no request schema, an EntryRevision is never created directly, only
// snapshotted internally on entry writes.
export const entryRevisionSchema = z.object({
  id: z.string(),
  entryId: z.string(),
  slug: z.string(),
  status: z.enum(ENTRY_STATUSES),
  data: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});

export type EntryRevision = z.infer<typeof entryRevisionSchema>;
