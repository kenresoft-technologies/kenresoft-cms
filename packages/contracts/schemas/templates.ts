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

export const updateTemplateSchema = createTemplateSchema.partial();

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
