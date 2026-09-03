import { z } from 'zod';

import { slugSchema } from './common';
import { ENTRY_STATUSES } from './enums';

export const entrySchema = z.object({
  id: z.string(),
  contentTypeId: z.string(),
  slug: z.string(),
  status: z.enum(ENTRY_STATUSES),
  data: z.record(z.string(), z.unknown()),
  publishAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// z.null() must come before z.coerce.date() — coercion treats null as epoch (new Date(null))
// rather than failing, so checking the exact-null case first is what makes "clear the
// schedule" (explicit null) behave differently from "leave it alone" (omitted).
const publishAtInputSchema = z.union([z.null(), z.coerce.date()]);

export const createEntrySchema = z.object({
  slug: slugSchema,
  status: z.enum(ENTRY_STATUSES).optional().default('draft'),
  data: z.record(z.string(), z.unknown()),
  publishAt: publishAtInputSchema.optional(),
});

export const updateEntrySchema = z.object({
  slug: slugSchema.optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  publishAt: publishAtInputSchema.optional(),
});

export type Entry = z.infer<typeof entrySchema>;
export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;

// A single entry's portable shape for export/import — no id/contentTypeId/timestamps, since
// those are either internal (id, ownership timestamps) or supplied by whichever content type
// the file is being imported into, not carried in the file itself.
export const exportedEntrySchema = z.object({
  slug: slugSchema,
  status: z.enum(ENTRY_STATUSES),
  data: z.record(z.string(), z.unknown()),
  publishAt: z.string().nullable(),
});

export type ExportedEntry = z.infer<typeof exportedEntrySchema>;

// The content type identity travels with the file so an import can refuse a file exported from
// a different content type by mistake (checked by slug, since ids aren't portable across
// deployments) — see contentTypeExportSchema below for the export shape this input is meant to
// come from.
export const importEntriesSchema = z.object({
  contentType: z.object({ name: z.string(), slug: z.string() }).optional(),
  entries: z.array(exportedEntrySchema),
});

export type ImportEntriesInput = z.infer<typeof importEntriesSchema>;

export const importEntriesResultSchema = z.object({
  created: z.number(),
  updated: z.number(),
  errors: z.array(z.object({ slug: z.string(), error: z.string() })),
});

export type ImportEntriesResult = z.infer<typeof importEntriesResultSchema>;

export const contentTypeExportSchema = z.object({
  contentType: z.object({ name: z.string(), slug: z.string() }),
  exportedAt: z.string(),
  entries: z.array(exportedEntrySchema),
});

export type ContentTypeExport = z.infer<typeof contentTypeExportSchema>;

// Admin-only — backs the unified "all entries" listing across every content type. Deliberately
// NOT folded into entrySchema: entrySchema is reused verbatim by the public, unauthenticated
// content API (apps/api/src/routes/public/content.ts), and this shape's authorName/authorEmail
// would leak an internal user's identity to anonymous visitors if it were.
export const entryWithContentTypeSchema = entrySchema.extend({
  contentTypeName: z.string(),
  contentTypeSlug: z.string(),
  authorName: z.string().nullable(),
  authorEmail: z.string().nullable(),
});

export type EntryWithContentType = z.infer<typeof entryWithContentTypeSchema>;
