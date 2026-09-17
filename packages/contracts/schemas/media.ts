import { z } from 'zod';

import { MEDIA_CONTENT_TYPES, MEDIA_DOCUMENT_CONTENT_TYPES, MEDIA_VISIBILITIES } from './enums';

export const mediaSchema = z.object({
  id: z.string(),
  key: z.string(),
  filename: z.string(),
  // Admin-facing Media can be either the public image contract or (only when `visibility` is
  // 'private') one of MEDIA_DOCUMENT_CONTENT_TYPES — publicMediaSchema below deliberately keeps
  // the narrower, image-only enum, since it's the one contract external/public consumers see.
  contentType: z.enum([...MEDIA_CONTENT_TYPES, ...MEDIA_DOCUMENT_CONTENT_TYPES]),
  size: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  altText: z.string().nullable(),
  visibility: z.enum(MEDIA_VISIBILITIES),
  // null = unfiled/root — every media item that predates folders keeps working unmodified.
  folderId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const mediaFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  // null = a top-level folder.
  parentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const folderSlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers, and hyphens only');

export const createMediaFolderSchema = z.object({
  name: z.string().min(1).max(200),
  slug: folderSlugSchema,
  parentId: z.string().min(1).nullable().optional(),
});

export const updateMediaFolderSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: folderSlugSchema.optional(),
  // Explicit null moves the folder to top-level; omitted leaves it where it is.
  parentId: z.string().min(1).nullable().optional(),
});

// Moving media between folders — a dedicated small request shape (a list of media ids plus the
// target folder) rather than overloading a per-item PATCH, since "move N files at once" is the
// Media Library's actual UI action.
export const moveMediaSchema = z.object({
  mediaIds: z.array(z.string().min(1)).min(1).max(200),
  folderId: z.string().min(1).nullable(),
});

// No create-request schema — upload is multipart/form-data (a file plus an optional altText
// field), validated by sniffing the file's actual bytes rather than a declared MIME type, so
// it doesn't fit a static JSON body schema. altTextSchema alone is still useful standalone
// for the one plain-string field the route does validate with Zod.
export const altTextSchema = z.string().max(500).optional();

// Renaming/re-describing an already-uploaded item — never the file's bytes/key/contentType,
// which are immutable once uploaded (§14). Hand-written, not `mediaSchema.pick({...}).partial()`
// — no field here has a `.default()` today, but every prior `.partial()`-of-a-create-schema in
// this codebase eventually got bitten by that trap once its base schema gained one (Site Builder
// Phase 10's hardening pass), so new update schemas are written by hand from day one.
export const updateMediaSchema = z.object({
  filename: z.string().min(1).max(255).optional(),
  altText: z.string().max(500).nullable().optional(),
  // Toggling visibility is allowed (e.g. marking an existing public asset private); the API
  // route rejects switching a document-content-type asset to 'public', since that would violate
  // the public image-only contract (publicMediaSchema/MEDIA_CONTENT_TYPES).
  visibility: z.enum(MEDIA_VISIBILITIES).optional(),
});

// The subset of Media that's safe to expose from the public API (GET /api/v1/public/media/:id)
// alongside the already-public file bytes (.../media/:id/file) — no key (the internal R2
// object path), filename, or timestamps, since those describe internal storage rather than
// how to render the file. altText/width/height close a real gap for public consumers (e.g.
// @kenresoft-cms/astro): the file route alone gives no way to set an <img alt> or avoid layout
// shift while the image loads.
export const publicMediaSchema = z.object({
  altText: z.string().nullable(),
  contentType: z.enum(MEDIA_CONTENT_TYPES),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

// Same shape as publicMediaSchema plus an id — needed for a folder listing, where a frontend
// developer needs to build a file URL (media.url({id})) for each item, unlike the single-item
// GET .../media/:id route where the caller already has the id.
export const publicMediaListItemSchema = publicMediaSchema.extend({ id: z.string() });

export type Media = z.infer<typeof mediaSchema>;
export type PublicMediaListItem = z.infer<typeof publicMediaListItemSchema>;
export type PublicMedia = z.infer<typeof publicMediaSchema>;
export type MediaFolder = z.infer<typeof mediaFolderSchema>;
export type CreateMediaFolderInput = z.infer<typeof createMediaFolderSchema>;
export type UpdateMediaFolderInput = z.infer<typeof updateMediaFolderSchema>;
export type MoveMediaInput = z.infer<typeof moveMediaSchema>;
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;
