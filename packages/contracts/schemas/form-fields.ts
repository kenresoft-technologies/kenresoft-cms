import { z } from 'zod';

import { FORM_FIELD_TYPES } from './enums';

export const formFieldSchema = z.object({
  id: z.string(),
  formId: z.string(),
  name: z.string(),
  label: z.string(),
  fieldType: z.enum(FORM_FIELD_TYPES),
  required: z.boolean(),
  sortOrder: z.number().int(),
  config: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createFormFieldSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  fieldType: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().optional().default(false),
  // No default here — the route auto-assigns the next position when omitted, same as
  // content-type field definitions.
  sortOrder: z.number().int().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

// sortOrder excluded — no reorder endpoint exists for form fields (unlike content-type
// fields), but a plain edit still shouldn't silently move a field's position.
//
// A production-hardening fix (docs/SITE_BUILDER.md §24's follow-up pass, mirroring the
// identical fix to field-definitions.ts's updateFieldDefinitionSchema): this used to be
// `createFormFieldSchema.omit({sortOrder:true}).partial()` — `.partial()` doesn't strip an
// already-present `.default(...)`, so a PATCH omitting `required` still parsed to `required:
// false`, silently un-requiring that field on any partial update. A hand-written schema is the
// fix — no field here has a `.default()`.
export const updateFormFieldSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(200).optional(),
  fieldType: z.enum(FORM_FIELD_TYPES).optional(),
  required: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type FormField = z.infer<typeof formFieldSchema>;
export type CreateFormFieldInput = z.infer<typeof createFormFieldSchema>;
export type UpdateFormFieldInput = z.infer<typeof updateFormFieldSchema>;
