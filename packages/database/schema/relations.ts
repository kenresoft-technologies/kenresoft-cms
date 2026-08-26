import { relations } from 'drizzle-orm';

import { projects } from './projects';
import { contentTypes } from './content-types';
import { fieldDefinitions } from './field-definitions';
import { entries } from './entries';

export const projectsRelations = relations(projects, ({ many }) => ({
  contentTypes: many(contentTypes),
  entries: many(entries),
}));

export const contentTypesRelations = relations(contentTypes, ({ one, many }) => ({
  project: one(projects, { fields: [contentTypes.projectId], references: [projects.id] }),
  fields: many(fieldDefinitions),
  entries: many(entries),
}));

export const fieldDefinitionsRelations = relations(fieldDefinitions, ({ one }) => ({
  contentType: one(contentTypes, {
    fields: [fieldDefinitions.contentTypeId],
    references: [contentTypes.id],
  }),
}));

export const entriesRelations = relations(entries, ({ one }) => ({
  project: one(projects, { fields: [entries.projectId], references: [projects.id] }),
  contentType: one(contentTypes, {
    fields: [entries.contentTypeId],
    references: [contentTypes.id],
  }),
}));
