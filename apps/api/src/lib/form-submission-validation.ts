import { z } from 'zod';
import type { FormField } from '@kenresoft/database';

// Public form input is adversarial by default (§9) — strips every angle bracket from a
// string value before it's ever persisted, rather than trusting that Zod's type/format
// validation alone makes content safe to store and later render. Deliberately not a
// tag-pair regex (replace(/<[^>]*>/g, '')): that only removes well-formed <tag>...</tag>
// pairs and leaves a tag's own text content behind (e.g. "<script>alert(1)</script>" becomes
// "alert(1)", not ""), plus matched-pair stripping is a well-known pattern for adversarial
// input to defeat with malformed/nested markup. Removing every '<' and '>' individually
// guarantees no tag can ever be reconstructed from the output, full stop, regardless of how
// the input was structured — the leftover text may look garbled, but it can't ever parse as
// markup. No DOM parser is available in the Workers runtime to do this more precisely.
function sanitizeText(value: string): string {
  return value.replace(/[<>]/g, '').trim();
}

function schemaForField(field: FormField): z.ZodTypeAny {
  let base: z.ZodTypeAny;

  switch (field.fieldType) {
    case 'email':
      base = z.email().max(320).transform(sanitizeText);
      break;
    case 'url':
      base = z.url().max(2000).transform(sanitizeText);
      break;
    case 'number':
      base = z.coerce.number();
      break;
    case 'checkbox':
      base = z.coerce.boolean();
      break;
    case 'date':
      base = z.coerce.date();
      break;
    case 'select': {
      const options = field.config?.['options'];
      base =
        Array.isArray(options) && options.length > 0 && options.every((o) => typeof o === 'string')
          ? z.enum(options as [string, ...string[]])
          : z.string().min(1).max(500).transform(sanitizeText);
      break;
    }
    case 'textarea':
      base = z.string().min(1).max(5000).transform(sanitizeText);
      break;
    case 'text':
    default:
      base = z.string().min(1).max(500).transform(sanitizeText);
  }

  return field.required ? base : base.optional();
}

export interface SubmissionValidationResult {
  data?: Record<string, unknown>;
  issues?: { path: PropertyKey[]; message: string }[];
}

// Builds the submission's validation schema dynamically from the form's own field
// definitions (§18) — there's no static shape for "a form submission" the way there is for,
// say, a content type, since every form defines its own fields. Unknown keys in the input are
// silently dropped (Zod's default z.object() behavior), not rejected — no reason to fail a
// legitimate submission over one extra field a client sent.
export function validateSubmission(fields: FormField[], input: unknown): SubmissionValidationResult {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = schemaForField(field);
  }

  const result = z.object(shape).safeParse(input);
  if (!result.success) {
    return {
      issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    };
  }
  return { data: result.data };
}
