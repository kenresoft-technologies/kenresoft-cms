import { z } from 'zod';
import type { FormField } from '@kenresoft-cms/database';

import { sniffAttachment } from './attachment-metadata';

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

// §14's own image-upload ceiling — a reasonable cap for a resume/cover-letter attachment, not
// a hard platform limit.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface ValidatedAttachment {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

export interface SubmissionValidationResult {
  data?: Record<string, unknown>;
  // Keyed by field name — not yet written to R2 (see routes/public/forms.ts), so a validation
  // failure elsewhere in the same submission never leaves an orphaned object in storage.
  files?: Record<string, ValidatedAttachment>;
  issues?: { path: PropertyKey[]; message: string }[];
}

// Builds the submission's validation schema dynamically from the form's own field
// definitions (§18) — there's no static shape for "a form submission" the way there is for,
// say, a content type, since every form defines its own fields. Unknown keys in the input are
// silently dropped (Zod's default z.object() behavior), not rejected — no reason to fail a
// legitimate submission over one extra field a client sent. `file`-type fields are validated
// separately from the rest (bytes sniffed via attachment-metadata.ts, §9's "never trust the
// declared type" standard) since they arrive as File objects from a multipart body, never as
// part of the JSON-validatable shape.
export async function validateSubmission(
  fields: FormField[],
  input: unknown,
  uploadedFiles: Map<string, File>,
): Promise<SubmissionValidationResult> {
  const textFields = fields.filter((field) => field.fieldType !== 'file');
  const fileFields = fields.filter((field) => field.fieldType === 'file');

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of textFields) {
    shape[field.name] = schemaForField(field);
  }
  const result = z.object(shape).safeParse(input);

  const issues: { path: PropertyKey[]; message: string }[] = result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));

  const files: Record<string, ValidatedAttachment> = {};
  for (const field of fileFields) {
    const file = uploadedFiles.get(field.name);
    if (!file || file.size === 0) {
      if (field.required) issues.push({ path: [field.name], message: 'File is required' });
      continue;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      issues.push({ path: [field.name], message: `File must be at most ${MAX_ATTACHMENT_BYTES} bytes` });
      continue;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffAttachment(bytes);
    if (!sniffed) {
      issues.push({ path: [field.name], message: 'Unsupported or unrecognized file format' });
      continue;
    }

    files[field.name] = {
      bytes,
      filename: file.name || `upload.${sniffed.extension}`,
      contentType: sniffed.contentType,
    };
  }

  if (issues.length > 0) {
    return { issues };
  }
  return { data: result.success ? result.data : {}, files };
}
