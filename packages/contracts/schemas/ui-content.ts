import { z } from 'zod';

import { FIELD_TYPES } from './enums';

// The same slug shape content-types/forms already use.
const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers, and hyphens only');

// One field definition on a UI content TYPE — deliberately the same shape/vocabulary as
// content-types' own field-definitions.ts (name/label/fieldType/required/config), reusing
// FIELD_TYPES rather than inventing a second field-type enum for what is, structurally, the
// same idea at a smaller scale.
export const uiContentFieldDefinitionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Field name must be a valid identifier'),
  label: z.string().min(1).max(200),
  fieldType: z.enum(FIELD_TYPES),
  required: z.boolean(),
  config: z.record(z.string(), z.unknown()),
});

export type UiContentFieldDefinition = z.infer<typeof uiContentFieldDefinitionSchema>;

export const uiContentTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  fields: z.array(uiContentFieldDefinitionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createUiContentTypeSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  fields: z.array(uiContentFieldDefinitionSchema).max(50).optional(),
});

// Hand-written, not createUiContentTypeSchema.partial() — this codebase's own hardening pass
// (docs/ARCHITECTURE.md's Changelog, "Site builder Phase 10") found that pattern silently
// resurrects a base schema's own .optional().default(...) on every field a partial update
// omits, corrupting data. None of this schema's fields have a default, but writing every
// update schema by hand from day one avoids waiting to be bitten by the same class of bug the
// moment one gains one.
export const updateUiContentTypeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: slugSchema.optional(),
  fields: z.array(uiContentFieldDefinitionSchema).max(50).optional(),
});

export const uiContentItemSchema = z.object({
  id: z.string(),
  uiContentTypeId: z.string(),
  slug: z.string(),
  data: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createUiContentItemSchema = z.object({
  slug: slugSchema,
  data: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

export const updateUiContentItemSchema = z.object({
  slug: slugSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

// The public shape omits nothing beyond internal ids not meaningful to a frontend consumer —
// unlike Entries, a UI content item has no draft/published distinction to hide (disabled items
// are excluded at the query layer entirely, the same "a draft 404s exactly like nonexistent"
// convention Entries/Pages already use, applied here to `enabled`).
export const publicUiContentItemSchema = z.object({
  slug: z.string(),
  data: z.record(z.string(), z.unknown()),
  updatedAt: z.string(),
});

export type UiContentType = z.infer<typeof uiContentTypeSchema>;
export type CreateUiContentTypeInput = z.infer<typeof createUiContentTypeSchema>;
export type UpdateUiContentTypeInput = z.infer<typeof updateUiContentTypeSchema>;
export type UiContentItem = z.infer<typeof uiContentItemSchema>;
export type CreateUiContentItemInput = z.infer<typeof createUiContentItemSchema>;
export type UpdateUiContentItemInput = z.infer<typeof updateUiContentItemSchema>;
export type PublicUiContentItem = z.infer<typeof publicUiContentItemSchema>;
