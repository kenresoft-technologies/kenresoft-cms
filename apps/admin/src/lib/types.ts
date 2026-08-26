// Local response shapes for the admin API — timestamps are strings over the wire, unlike
// packages/database's Date-typed columns, so these are intentionally not shared with the
// backend (importing the DB package into a browser bundle isn't desirable either — its
// schema modules pull in drizzle-orm). Phase 6 (docs/ARCHITECTURE.md §20) replaces this with
// generated contract types shared through packages/contracts.
export interface Project {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentType {
  id: string;
  projectId: string;
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
