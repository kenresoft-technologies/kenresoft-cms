// Initial content field types per docs/ARCHITECTURE.md §6.1. Owned here rather than by
// packages/database because apps/admin consumes this array as a runtime value (rendering
// field-type <Select> options) — packages/database's schema files call sqliteTable(...) at
// module scope, a side-effecting call that would drag drizzle-orm into the browser bundle if
// admin imported the array from there directly.
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
