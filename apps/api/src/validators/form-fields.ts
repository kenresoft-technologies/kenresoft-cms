import { z } from 'zod';
import { FORM_FIELD_TYPES } from '@kenresoft/contracts';

export const createFormFieldSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  fieldType: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().optional().default(false),
  // No default here — the route auto-assigns the next position when omitted, so fields added
  // one at a time (the common case) come back in creation order instead of all tying at 0.
  sortOrder: z.number().int().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});
