import { z } from 'zod';

import { blockInstanceSchema } from './blocks';

// Phase 4 of the schema-driven frontend work (docs/SITE_BUILDER.md §3.5/§4.1): a default block
// composition copied into a new Page at creation time — never live-linked (§3.5), unlike
// reusable_blocks.
export const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentTypeId: z.string().nullable(),
  blocks: z.array(blockInstanceSchema),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Template = z.infer<typeof templateSchema>;

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  contentTypeId: z.string().nullable().optional(),
  blocks: z.array(blockInstanceSchema).optional().default([]),
  isDefault: z.boolean().optional().default(false),
});

// A production-hardening fix (docs/SITE_BUILDER.md §24's follow-up pass): this used to be
// `createTemplateSchema.partial()` — `.partial()` only widens each field's *type* to optional,
// it does not strip an already-present `.default(...)`, so a PATCH that simply omits `blocks`
// (e.g. renaming a template) still parsed to `blocks: []` rather than `undefined` — and `[]` is
// truthy, so `routes/admin/templates.ts`'s own `input.blocks ? {...} : undefined` guard never
// caught it, silently wiping the template's entire block composition. `isDefault` had the same
// defect (always reset to `false`). A hand-written schema, matching `updatePageSchema`'s
// already-correct pattern, is the fix — no field here has a `.default()`, so an omitted field
// parses to real `undefined`, correctly distinguishable from an explicitly-sent value.
export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contentTypeId: z.string().nullable().optional(),
  blocks: z.array(blockInstanceSchema).optional(),
  isDefault: z.boolean().optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
