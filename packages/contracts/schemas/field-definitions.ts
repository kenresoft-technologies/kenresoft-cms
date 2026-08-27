import { z } from 'zod';

// Initial content field types per docs/ARCHITECTURE.md §6.1. Owned here rather than by
// packages/database because apps/admin consumes this array as a runtime value (rendering
// field-type <Select> options) — packages/database's schema files call sqliteTable(...) at
// module scope, a side-effecting call that would drag drizzle-orm into the browser bundle if
// admin imported the array from there directly.
export const FIELD_TYPES = [
  'text',
  'textarea',
  'rich_text',
  'number',
  'boolean',
  'date',
  'datetime',
  'slug',
  'email',
  'url',
  'select',
  'multi_select',
  'media',
  'reference',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

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
