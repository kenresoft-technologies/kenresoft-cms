// Every enum array consumed as a runtime value somewhere (apps/admin renders several of these
// as <Select> options; apps/api's validators build z.enum(...) from them) lives in this one
// module, deliberately with zero zod import — every domain schema file below imports its enum
// from here rather than declaring it locally. Splitting this out isn't just organizational: a
// domain file that both defines an enum AND builds zod schemas from it can't be safely
// tree-shaken by Rollup — z.object(...) call expressions are opaque, non-provably-pure
// function calls, so importing just the enum from such a file still pulls the whole module
// (zod included) into whatever bundle imports it. Confirmed empirically once during the
// packages/contracts + @hono/zod-openapi migration: apps/admin's production bundle contained
// ZodError/ZodObject/ZodType even though its own code only ever did `export type` re-exports —
// the leak came from re-exporting FIELD_TYPES etc. out of files that also called z.object(...)
// at module scope. This file exists so that never happens again.

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

export const ENTRY_STATUSES = ['draft', 'published'] as const;

export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const FORM_FIELD_TYPES = ['text', 'textarea', 'email', 'url', 'number', 'select', 'checkbox', 'date'] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_SUBMISSION_STATUSES = ['new', 'read', 'archived'] as const;

export type FormSubmissionStatus = (typeof FORM_SUBMISSION_STATUSES)[number];

// Raster image types accepted for V1 (§14) — verified against the file's actual bytes at
// upload time, not the client-supplied Content-Type (§9: never trust browser-provided MIME
// types alone). Other media (PDF/doc, etc.) is future work.
export const MEDIA_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

export const USER_ROLES = ['owner', 'editor'] as const;

export type UserRole = (typeof USER_ROLES)[number];
