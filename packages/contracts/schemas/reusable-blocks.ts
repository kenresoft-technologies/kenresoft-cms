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

// A production-hardening fix (docs/SITE_BUILDER.md §24's follow-up pass): this used to be
// `createReusableBlockSchema.partial()` — `.partial()` only widens each field's *type* to
// optional, it does not strip an already-present `.default(...)`, so a PATCH that omits
// `config` entirely (e.g. renaming a reusable block) still parsed to `config: {}` rather than
// `undefined`, silently wiping the block's config on write. A hand-written schema, matching
// `updatePageSchema`'s already-correct pattern, is the fix — no field here has a `.default()`,
// so an omitted field parses to real `undefined`, correctly distinguishable from an
// explicitly-sent value.
export const updateReusableBlockSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: reusableBlockTypeSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type CreateReusableBlockInput = z.infer<typeof createReusableBlockSchema>;
export type UpdateReusableBlockInput = z.infer<typeof updateReusableBlockSchema>;
