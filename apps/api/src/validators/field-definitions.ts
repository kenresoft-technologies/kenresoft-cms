import { z } from 'zod';
import { FIELD_TYPES } from '@kenresoft/database';

export const createFieldDefinitionSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  fieldType: z.enum(FIELD_TYPES),
  required: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional().default(0),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const reorderFieldDefinitionsSchema = z.object({
  fieldIds: z.array(z.string().min(1)).min(1),
});
