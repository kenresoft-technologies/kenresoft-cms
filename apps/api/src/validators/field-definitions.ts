import { z } from 'zod';
import { FIELD_TYPES } from '@kenresoft/contracts';

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
