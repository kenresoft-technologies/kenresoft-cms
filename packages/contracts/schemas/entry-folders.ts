import { z } from 'zod';

// Real hierarchical folders scoped per content type, organizing Entry instances only — never
// part of a content type's own field-definition shape. Mirrors media-folders.ts's contract
// shape/naming conventions.
export const entryFolderSchema = z.object({
  id: z.string(),
  contentTypeId: z.string(),
  name: z.string(),
  // null = a top-level folder within this content type.
  parentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createEntryFolderSchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().min(1).nullable().optional(),
});

// Hand-written, not `.partial()` — createEntryFolderSchema has no `.default()` field today, so
// `.partial()` would actually be safe here too, but every new update schema in this codebase
// skips the pattern entirely from day one per the CLAUDE.md-documented `.partial()`-plus-default
// lesson, rather than waiting to be bitten if a default is ever added later.
export const updateEntryFolderSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  // Explicit null clears back to root; omitted means "leave unchanged."
  parentId: z.string().min(1).nullable().optional(),
});

// Moving one or many entries into a folder (or back to root, via a null folderId) — mirrors
// moveMediaSchema's own shape/reasoning in media.ts exactly (a dedicated bulk-move request
// shape, since "move N entries at once" is the real Entries-page UI action).
export const moveEntriesSchema = z.object({
  entryIds: z.array(z.string().min(1)).min(1).max(500),
  folderId: z.string().min(1).nullable(),
});

export type EntryFolder = z.infer<typeof entryFolderSchema>;
export type CreateEntryFolderInput = z.infer<typeof createEntryFolderSchema>;
export type UpdateEntryFolderInput = z.infer<typeof updateEntryFolderSchema>;
export type MoveEntriesInput = z.infer<typeof moveEntriesSchema>;
