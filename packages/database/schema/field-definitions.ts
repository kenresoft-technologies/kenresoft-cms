import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { contentTypes } from './content-types';

// Initial content field types per docs/ARCHITECTURE.md §6.1.
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

export const fieldDefinitions = sqliteTable(
  'field_definitions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    contentTypeId: text('content_type_id')
      .notNull()
      .references(() => contentTypes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull().$type<FieldType>(),
    required: integer('required', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    // Type-specific config (e.g. select options, reference target, max length) — validated
    // at the API layer with Zod (§9), not constrained at the DB layer.
    config: text('config', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex('field_definitions_content_type_name_unique').on(table.contentTypeId, table.name),
  ],
);

export type FieldDefinition = typeof fieldDefinitions.$inferSelect;
export type NewFieldDefinition = typeof fieldDefinitions.$inferInsert;
