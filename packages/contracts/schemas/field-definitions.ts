import { z } from 'zod';

import { FIELD_TYPES } from './enums';

// Presentation metadata: how a field's value is DISPLAYED, never how it's validated or
// stored (docs/SITE_BUILDER.md §3.6/§9 of the brief) — deliberately a separate, optional,
// nullable column from `config` (which stays purely data/validation shape: select options,
// a reference target, etc.). Every key here is a plain, developer-defined string looked up
// against a code-registered renderer registry (never executed, never interpreted as code —
// see integrations/astro/src/render/field-renderers.ts's resolution precedence and the
// security note in docs/SITE_BUILDER.md §7). `.strict()` so an unrecognized key is rejected
// at write time rather than silently stored and never consulted.
export const fieldPresentationSchema = z
  .object({
    renderer: z.string().min(1).max(100).optional(),
    format: z.string().min(1).max(100).optional(),
    label: z.string().min(1).max(200).optional(),
    displayMode: z.string().min(1).max(100).optional(),
    variant: z.string().min(1).max(100).optional(),
    alignment: z.string().min(1).max(100).optional(),
  })
  .strict();

export type FieldPresentation = z.infer<typeof fieldPresentationSchema>;

export const fieldDefinitionSchema = z.object({
  id: z.string(),
  contentTypeId: z.string(),
  name: z.string(),
  label: z.string(),
  fieldType: z.enum(FIELD_TYPES),
  required: z.boolean(),
  sortOrder: z.number().int(),
  config: z.record(z.string(), z.unknown()).nullable(),
  presentation: fieldPresentationSchema.nullable(),
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
  presentation: fieldPresentationSchema.nullable().optional(),
});

export const reorderFieldDefinitionsSchema = z.object({
  fieldIds: z.array(z.string().min(1)).min(1),
});

// sortOrder excluded — that's the reorder endpoint's job, not a plain field edit.
//
// A production-hardening fix (docs/SITE_BUILDER.md §24's follow-up pass): this used to be
// `createFieldDefinitionSchema.omit({sortOrder:true}).partial()` — `.partial()` only widens
// each field's *type* to optional, it does not strip an already-present `.default(...)`, so a
// PATCH that edits only `label` (or any other field) while omitting `required` still parsed to
// `required: false` rather than `undefined`, silently un-requiring that field on every partial
// update that didn't explicitly resend it (routes/admin/content-types.ts's update handler has
// no defensive check — it writes `input` straight through). A hand-written schema, matching
// `updatePageSchema`'s already-correct pattern, is the fix — no field here has a `.default()`,
// so an omitted field parses to real `undefined`.
export const updateFieldDefinitionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(200).optional(),
  fieldType: z.enum(FIELD_TYPES).optional(),
  required: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  presentation: fieldPresentationSchema.nullable().optional(),
});

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export type CreateFieldDefinitionInput = z.infer<typeof createFieldDefinitionSchema>;
export type UpdateFieldDefinitionInput = z.infer<typeof updateFieldDefinitionSchema>;
export type ReorderFieldDefinitionsInput = z.infer<typeof reorderFieldDefinitionsSchema>;
