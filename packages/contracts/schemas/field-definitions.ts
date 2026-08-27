import { z } from 'zod';

import { FIELD_TYPES } from './enums';

export const fieldDefinitionSchema = z.object({
  id: z.string(),
  contentTypeId: z.string(),
  name: z.string(),
  label: z.string(),
  fieldType: z.enum(FIELD_TYPES),
  required: z.boolean(),
  sortOrder: z.number().int(),
  config: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createFieldDefinitionSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  fieldType: z.enum(FIELD_TYPES),
  required: z.boolean().optional().default(false),
  // No default here — the route auto-assigns the next position when omitted, so fields added
  // one at a time (the common case) come back in creation order instead of all tying at 0.
  sortOrder: z.number().int().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const reorderFieldDefinitionsSchema = z.object({
  fieldIds: z.array(z.string().min(1)).min(1),
});

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export type CreateFieldDefinitionInput = z.infer<typeof createFieldDefinitionSchema>;
export type ReorderFieldDefinitionsInput = z.infer<typeof reorderFieldDefinitionsSchema>;
