import { z } from 'zod';

import { REUSABLE_BLOCK_TYPES } from './enums';

// Phase 4 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.4/§4.1). `type` is
// restricted to REUSABLE_BLOCK_TYPES (leaf, non-referencing block types) — never "columns"
// (nowhere to store children here) and never "reusableBlockRef" itself (no reference chains).
export const reusableBlockTypeSchema = z.enum(REUSABLE_BLOCK_TYPES);

export const reusableBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: reusableBlockTypeSchema,
  config: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ReusableBlock = z.infer<typeof reusableBlockSchema>;

export const createReusableBlockSchema = z.object({
  name: z.string().min(1).max(200),
  type: reusableBlockTypeSchema,
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateReusableBlockSchema = createReusableBlockSchema.partial();

export type CreateReusableBlockInput = z.infer<typeof createReusableBlockSchema>;
export type UpdateReusableBlockInput = z.infer<typeof updateReusableBlockSchema>;
