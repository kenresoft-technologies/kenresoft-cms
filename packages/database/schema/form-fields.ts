import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { forms } from './forms';
// FORM_FIELD_TYPES itself lives in packages/contracts — see field-definitions.ts for why.
import type { FormFieldType } from '@kenresoft-cms/contracts';

export type { FormFieldType };

export const formFields = sqliteTable(
  'form_fields',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    formId: text('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull().$type<FormFieldType>(),
    required: integer('required', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    // Type-specific config (e.g. select options) — validated at the API layer, not the DB
    // layer, same convention as field-definitions.ts.
    config: text('config', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [uniqueIndex('form_fields_form_id_name_unique').on(table.formId, table.name)],
);

export type FormField = typeof formFields.$inferSelect;
export type NewFormField = typeof formFields.$inferInsert;
