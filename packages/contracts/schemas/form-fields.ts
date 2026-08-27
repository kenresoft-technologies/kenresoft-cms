import { z } from 'zod';

export const FORM_FIELD_TYPES = ['text', 'textarea', 'email', 'url', 'number', 'select', 'checkbox', 'date'] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

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

export type FormField = z.infer<typeof formFieldSchema>;
export type CreateFormFieldInput = z.infer<typeof createFormFieldSchema>;
