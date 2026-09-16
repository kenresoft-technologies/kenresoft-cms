import { z } from 'zod';
import type { UiContentFieldDefinition } from '@kenresoft-cms/contracts';

// Builds a validation schema dynamically from a UI content TYPE's own field definitions — the
// same "no static shape, build one per type from its own field list" approach
// form-submission-validation.ts already uses for form submissions, applied here to FIELD_TYPES
// (content-types' own field-type vocabulary) instead of FORM_FIELD_TYPES. Closes the gap Entries
// themselves still have (no server-side field validation at all, an accepted, documented gap) —
// UI Content is smaller and newer, so there's no existing behavior to preserve by leaving it
// unvalidated too.
function schemaForField(field: UiContentFieldDefinition): z.ZodTypeAny {
  let base: z.ZodTypeAny;

  switch (field.fieldType) {
    case 'number':
      base = z.number();
      break;
    case 'boolean':
      base = z.boolean();
      break;
    case 'date':
    case 'datetime':
      base = z.string().min(1).max(50);
      break;
    case 'email':
      base = z.email().max(320);
      break;
    case 'url':
      base = z.url().max(2000);
      break;
    case 'select': {
      const options = field.config['options'];
      base =
        Array.isArray(options) && options.length > 0 && options.every((o) => typeof o === 'string')
          ? z.enum(options as [string, ...string[]])
          : z.string().max(500);
      break;
    }
    case 'multi_select':
      base = z.array(z.string()).max(100);
      break;
    case 'media':
    case 'reference':
    case 'slug':
      base = z.string().max(200);
      break;
    case 'rich_text':
      base = z.string().max(50000);
      break;
    case 'textarea':
      base = z.string().max(5000);
      break;
    case 'text':
    default:
      base = z.string().max(1000);
  }

  return field.required ? base : base.optional();
}

export interface UiContentValidationResult {
  data?: Record<string, unknown>;
  issues?: { path: PropertyKey[]; message: string }[];
}

// Unknown keys are silently dropped (Zod's default z.object() behavior) — the same "don't fail
// over one extra field" stance form submissions already take.
export function validateUiContentData(fields: UiContentFieldDefinition[], input: unknown): UiContentValidationResult {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = schemaForField(field);
  }
  const result = z.object(shape).safeParse(input);
  if (!result.success) {
    return { issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) };
  }
  return { data: result.data };
}
