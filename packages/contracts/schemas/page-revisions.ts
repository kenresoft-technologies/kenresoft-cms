import { z } from 'zod';

import { blockInstanceSchema } from './blocks';
import { ENTRY_STATUSES } from './enums';
import { pageSeoSchema } from './pages';

// Read/restore only — exact structural mirror of entry-revisions.ts: a PageRevision is never
// created directly, only snapshotted internally on every Page write (§3.2).
export const pageRevisionSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  title: z.string(),
  status: z.enum(ENTRY_STATUSES),
  blocks: z.array(blockInstanceSchema),
  seo: pageSeoSchema.nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});

export type PageRevision = z.infer<typeof pageRevisionSchema>;
