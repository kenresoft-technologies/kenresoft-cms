// Local response shapes for the admin API — timestamps are strings over the wire, unlike
// packages/database's Date-typed columns, so these are intentionally not shared with the
// backend (importing the DB package into a browser bundle isn't desirable either — its
// schema modules pull in drizzle-orm). Phase 6 (docs/ARCHITECTURE.md §20) replaces this with
// generated contract types shared through packages/contracts.
export interface ContentType {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

// Mirrors packages/database/schema/field-definitions.ts FIELD_TYPES.
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

export interface FieldDefinition {
  id: string;
  contentTypeId: string;
  name: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  sortOrder: number;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const ENTRY_STATUSES = ['draft', 'published'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export interface Entry {
  id: string;
  contentTypeId: string;
  slug: string;
  status: EntryStatus;
  data: Record<string, unknown>;
  publishAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntryRevision {
  id: string;
  entryId: string;
  slug: string;
  status: EntryStatus;
  data: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

// Mirrors packages/database/schema/media.ts MEDIA_CONTENT_TYPES.
export const MEDIA_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

export interface Media {
  id: string;
  key: string;
  filename: string;
  contentType: MediaContentType;
  size: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  contentTypeCount: number;
  entryCounts: { draft: number; published: number };
  mediaCount: number;
  mediaStorageBytes: number;
  recentEntries: {
    id: string;
    slug: string;
    status: EntryStatus;
    contentTypeId: string;
    contentTypeName: string;
    updatedAt: string;
  }[];
}
